/**
 * One agent run: rules pick the invoices that need attention AND the action + tone; Claude writes
 * the wording (template fallback if the AI is unavailable). Every decision becomes a PROPOSED
 * AgentAction. Nothing is executed here.
 */
import { Prisma } from "@prisma/client";
import { templateMessage, writeCollectionMessage, type Draft } from "@/lib/ai/collectionDecision";
import { clock } from "@/lib/clock";
import { num, prisma } from "@/lib/db";
import { money, shortDate } from "@/lib/format";
import { agentInvoiceInclude, claudeFacts, clientHistories, collectKey, contactHistory, factsFor, type AgentInvoice, type ClientHistory } from "./context";
import type { PaymentPlanPayload } from "./payloads";
import { assessInvoice, COLLECTIBLE_STATUSES, COLLECTION_ACTIONS, hasHardshipSignal, suggestedMinimum, type Assessment } from "./policy";
import { payoutItemsFor, proposePayout } from "./proposePayout";
import { collectionRationale } from "./rationale";
import { refreshRiskReasons, riskFor } from "./risk";

export interface RunSummary {
  runId: string;
  evaluated: number;
  proposed: number;
  skipped: number;
  errors: number;
}

interface Observation {
  invoice: string;
  verdict: string;
  daysOverdue?: number;
  outstanding?: number;
  actionId?: string;
  error?: string;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function proposeCollection(
  inv: AgentInvoice,
  a: Extract<Assessment, { attention: true }>,
  history: ClientHistory | undefined,
  now: Date,
): Promise<{ actionId?: string; verdict: string; model?: string }> {
  const facts = claudeFacts(inv, history, now);
  const planMinimum = a.action === "OFFER_PAYMENT_PLAN" ? suggestedMinimum(a.outstanding) : undefined;

  let draft: Draft;
  let model: string | undefined;
  try {
    ({ draft, model } = await writeCollectionMessage({ action: a.action, tone: a.tone, stage: a.stage, facts, planMinimum }));
  } catch (e) {
    console.warn(`AI wording failed for ${inv.number}; using template: ${errorText(e)}`);
    draft = templateMessage({
      action: a.action,
      tone: a.tone,
      number: inv.number,
      clientName: inv.project.client.name,
      amountText: money(a.outstanding, inv.currency),
      daysOverdue: a.daysOverdue,
      dueDateText: shortDate(inv.dueDate),
      planMinimumText: planMinimum ? money(planMinimum, inv.currency) : undefined,
      reason: a.reason,
    });
  }

  // `stage` and `tone` are stored so a later run can tell whether this proposal still fits.
  let payload: Prisma.InputJsonValue;
  if (a.action === "OFFER_PAYMENT_PLAN") {
    const plan: PaymentPlanPayload & { stage: string; tone: string } = {
      subject: draft.subject!,
      message: draft.message,
      currency: inv.currency,
      installments: 3,
      minimumAmount: planMinimum!,
      stage: a.stage,
      tone: a.tone,
    };
    payload = plan;
  } else if (a.action === "ESCALATE") {
    payload = { message: draft.message, stage: a.stage, tone: a.tone };
  } else {
    payload = { subject: draft.subject!, message: draft.message, stage: a.stage, tone: a.tone };
  }

  // Frozen now, from the same inputs the policy used, so the approver sees what the rules saw.
  const risk = riskFor(inv, history, now);
  const rationale = collectionRationale({
    now,
    currency: inv.currency,
    amount: num(inv.amount),
    amountPaid: num(inv.amountPaid),
    dueDate: inv.dueDate!,
    payments: inv.payments.map((p) => ({ amount: num(p.amount), paidAt: p.paidAt })),
    contacts: contactHistory(inv),
    risk: risk && { score: risk.score, factors: risk.factors },
    hardshipSignal: hasHardshipSignal(inv.project.client.notes),
    assessment: a,
    planMinimum,
    model: model ?? null,
  });

  // A stale pending proposal (the invoice escalated since) is superseded, never stacked.
  if (a.supersedes) {
    await prisma.agentAction.updateMany({
      where: { invoiceId: inv.id, type: { in: COLLECTION_ACTIONS }, status: "PROPOSED" },
      data: { status: "REJECTED", decidedAt: now, pendingKey: null, result: { superseded: true, reason: `Situation changed: now ${a.stage}.` } },
    });
  }

  try {
    const action = await prisma.agentAction.create({
      data: {
        type: a.action,
        invoiceId: inv.id,
        payload,
        reasoning: draft.reasoning,
        rationale: rationale as unknown as Prisma.InputJsonValue,
        isDemo: inv.isDemo,
        pendingKey: collectKey(inv.id),
        proposedAt: now,
      },
    });
    return { actionId: action.id, verdict: `proposed ${a.action} (${a.tone})${a.supersedes ? ", replacing an outdated proposal" : ""}`, model };
  } catch (e) {
    // Another run created a proposal for this invoice in the meantime (or one is APPROVED and executing).
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { verdict: "skipped: a proposal already exists", model };
    }
    throw e;
  }
}

export async function runAgent(trigger: string): Promise<RunSummary> {
  const now = await clock.now();
  const invoices = await prisma.invoice.findMany({
    where: { OR: [{ status: { in: COLLECTIBLE_STATUSES } }, { amountPaid: { gt: 0 }, payoutSplits: { some: {} } }] },
    include: agentInvoiceInclude,
    orderBy: { dueDate: "asc" },
  });
  const histories = await clientHistories([...new Set(invoices.map((i) => i.project.clientId))]);

  const observations: Observation[] = [];
  const actionIds: string[] = [];
  const models = new Set<string>();

  // 1. Collections.
  const collectible = invoices.filter((i) => COLLECTIBLE_STATUSES.includes(i.status));
  const assessed = collectible.map((inv) => ({ inv, assessment: assessInvoice(factsFor(inv), now) }));
  for (const { inv, assessment } of assessed) {
    if (!assessment.attention) {
      observations.push({
        invoice: inv.number,
        verdict: `skipped: ${assessment.reason}`,
        daysOverdue: assessment.daysOverdue,
        outstanding: assessment.outstanding,
      });
    }
  }

  const flagged = assessed.filter(
    (a): a is { inv: AgentInvoice; assessment: Extract<Assessment, { attention: true }> } => a.assessment.attention,
  );
  const results = await mapLimit(flagged, 3, async ({ inv, assessment }) => {
    const base = { invoice: inv.number, daysOverdue: assessment.daysOverdue, outstanding: assessment.outstanding };
    try {
      const r = await proposeCollection(inv, assessment, histories.get(inv.project.clientId)?.(inv.id), now);
      if (r.model) models.add(r.model);
      return { ...base, verdict: `${assessment.stage} (${assessment.reason}) → ${r.verdict}`, actionId: r.actionId };
    } catch (e) {
      return { ...base, verdict: `${assessment.stage}: failed`, error: errorText(e) };
    }
  });
  observations.push(...results);

  // 2. Subcontractor payouts owed on money already received (catches anything a webhook missed).
  for (const inv of invoices.filter((i) => num(i.amountPaid) > 0 && i.payoutSplits.length)) {
    if (!payoutItemsFor(inv).length) continue;
    try {
      const r = await proposePayout(inv.id);
      observations.push({
        invoice: inv.number,
        verdict: r.created ? "proposed PAYOUT_SUBCONTRACTORS" : `payout: ${r.reason}`,
        actionId: r.created ? r.actionId : undefined,
      });
    } catch (e) {
      observations.push({ invoice: inv.number, verdict: "payout: failed", error: errorText(e) });
    }
  }

  for (const o of observations) if (o.actionId) actionIds.push(o.actionId);
  const errors = observations.filter((o) => o.error).length;
  const proposed = actionIds.length;

  const decision =
    proposed || errors
      ? [
          proposed ? `Proposed ${proposed} action(s) for approval.` : "No new proposals.",
          errors ? `${errors} invoice(s) failed — see observations.` : "",
        ]
          .filter(Boolean)
          .join(" ")
      : `Checked ${collectible.length} open invoice(s); nothing needs action right now.`;

  // Risk reasons: regenerated only for invoices whose state changed (cached otherwise).
  try {
    await refreshRiskReasons();
  } catch (e) {
    observations.push({ invoice: "—", verdict: "risk reasons: failed", error: errorText(e) });
  }

  const log = await prisma.agentRunLog.create({
    data: {
      createdAt: now,
      trigger,
      observations: observations as unknown as Prisma.InputJsonValue,
      decision,
      actionIds,
      model: [...models].join(", ") || null,
    },
  });

  return {
    runId: log.id,
    evaluated: collectible.length,
    proposed,
    skipped: observations.length - proposed - errors,
    errors,
  };
}
