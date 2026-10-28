/**
 * One agent run: rules pick the invoices that need attention, Claude decides and writes,
 * and every decision becomes a PROPOSED AgentAction. Nothing is executed here.
 */
import { Prisma } from "@prisma/client";
import { decideCollectionAction } from "@/lib/ai/collectionDecision";
import { num, prisma } from "@/lib/db";
import { agentInvoiceInclude, claudeFacts, clientHistories, collectKey, factsFor, type AgentInvoice } from "./context";
import type { PaymentPlanPayload } from "./payloads";
import { assessInvoice, COLLECTIBLE_STATUSES, suggestedMinimum, type Assessment } from "./policy";
import { payoutItemsFor, proposePayout } from "./proposePayout";

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
  assessment: Extract<Assessment, { attention: true }>,
  facts: ReturnType<typeof claudeFacts>,
): Promise<{ actionId?: string; verdict: string; model?: string }> {
  const minimum = suggestedMinimum(assessment.outstanding);
  const { decision, model } = await decideCollectionAction({
    stage: assessment.stage,
    allowedActions: assessment.allowedActions as Array<"SEND_REMINDER" | "OFFER_PAYMENT_PLAN" | "ESCALATE">,
    facts,
    suggestedMinimum: minimum,
  });

  if (decision.action === "NONE") return { verdict: `AI chose no action: ${decision.reasoning}`, model };
  if (!decision.message || (decision.action !== "ESCALATE" && !decision.subject)) {
    throw new Error(`AI proposed ${decision.action} without a message`);
  }

  let payload: Prisma.InputJsonValue;
  if (decision.action === "OFFER_PAYMENT_PLAN") {
    const proposed = decision.paymentPlan?.minimumAmount ?? minimum;
    const plan: PaymentPlanPayload = {
      subject: decision.subject!,
      message: decision.message,
      currency: inv.currency,
      installments: Math.min(12, Math.max(2, decision.paymentPlan?.installments ?? 3)),
      // Keep the minimum sensible even if the model drifts.
      minimumAmount: proposed > 0 && proposed <= assessment.outstanding ? Math.round(proposed * 100) / 100 : minimum,
    };
    payload = plan;
  } else if (decision.action === "ESCALATE") {
    payload = { message: decision.message };
  } else {
    payload = { subject: decision.subject!, message: decision.message };
  }

  try {
    const action = await prisma.agentAction.create({
      data: {
        type: decision.action,
        invoiceId: inv.id,
        payload,
        reasoning: decision.reasoning,
        isDemo: inv.isDemo,
        pendingKey: collectKey(inv.id),
      },
    });
    return { actionId: action.id, verdict: `proposed ${decision.action}`, model };
  } catch (e) {
    // Another run created a proposal for this invoice in the meantime.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { verdict: "skipped: proposal created concurrently", model };
    }
    throw e;
  }
}

export async function runAgent(trigger: string): Promise<RunSummary> {
  const now = new Date();
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
      const facts = claudeFacts(inv, histories.get(inv.project.clientId)?.(inv.id), now);
      const r = await proposeCollection(inv, assessment, facts);
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

  const log = await prisma.agentRunLog.create({
    data: {
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
