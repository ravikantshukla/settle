/**
 * "Client replied": the freelancer pastes the client's reply to a reminder.
 *
 *   1. Claude reads it (untrusted data): category, summary, promised date, the terms asked for.
 *   2. CODE applies the freelancer's negotiation limits (limits.ts): clamp, or reject if impossible.
 *   3. Claude writes the response for the FINAL plan (template if the AI is down).
 *   4. A proposal goes to the inbox. Nothing is sent or changed in PayPal until it's approved.
 *
 * PROMISE_TO_PAY pauses reminders until the promised date; DISPUTE (or a hardship request no plan can
 * satisfy) becomes an ESCALATE note for the freelancer; OTHER is just recorded.
 */
import { Prisma } from "@prisma/client";
import { fallbackReading, readClientReply, type ReplyReading } from "@/lib/ai/clientReply";
import { writeCollectionMessage, type Draft } from "@/lib/ai/collectionDecision";
import { claudeFacts, clientHistories, collectKey, contactHistory, agentInvoiceInclude, type AgentInvoice } from "@/lib/agent/context";
import { COLLECTIBLE_STATUSES, COLLECTION_ACTIONS, hasHardshipSignal, invoiceStage } from "@/lib/agent/policy";
import { replyRationale } from "@/lib/agent/rationale";
import { riskFor } from "@/lib/agent/risk";
import { clock } from "@/lib/clock";
import { num, prisma } from "@/lib/db";
import { money } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { buildPlan, replyWarnings, type PlanOutcome } from "./limits";

export class ReplyError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "ReplyError";
  }
}

export interface ReplyResult {
  replyId: string;
  category: ReplyReading["category"];
  summary: string;
  warnings: string[];
  outcome: "plan_proposed" | "escalated" | "reminders_paused" | "recorded";
  actionId?: string;
  message: string;
}

export const MAX_REPLY_LENGTH = 5000;

export async function handleClientReply(invoiceId: string, rawText: string): Promise<ReplyResult> {
  const text = rawText.trim();
  if (!text) throw new ReplyError("Paste the client's reply first.");
  if (text.length > MAX_REPLY_LENGTH) throw new ReplyError(`Replies are limited to ${MAX_REPLY_LENGTH} characters.`);

  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: agentInvoiceInclude });
  if (!inv) throw new ReplyError("Invoice not found.", 404);
  if (!COLLECTIBLE_STATUSES.includes(inv.status)) throw new ReplyError(`Invoice ${inv.number} is ${inv.status}; there's nothing to negotiate.`, 409);

  const now = await clock.now();
  const settings = await getSettings();
  const history = (await clientHistories([inv.project.clientId])).get(inv.project.clientId)?.(inv.id);
  const facts = claudeFacts(inv, history, now, { name: settings.name, city: settings.city });

  // 1. Read the reply. Deterministic warnings don't depend on the AI.
  const warnings = replyWarnings(text);
  let reading: ReplyReading;
  let readBy: string | null = null;
  try {
    ({ reading, model: readBy } = await readClientReply({ reply: text, today: now.toISOString().slice(0, 10), invoice: facts.invoice }));
  } catch (e) {
    console.warn(`reading client reply failed; using keywords: ${e instanceof Error ? e.message : e}`);
    reading = fallbackReading(text, hasHardshipSignal(text));
  }

  const reply = await prisma.clientReply.create({
    data: {
      invoiceId: inv.id,
      text,
      receivedAt: now,
      category: reading.category,
      summary: reading.summary,
      promisedDate: reading.promisedDate ? new Date(`${reading.promisedDate}T00:00:00Z`) : null,
      request: (reading.requestedPlan ?? undefined) as Prisma.InputJsonValue | undefined,
      warnings: warnings.length ? warnings : undefined,
      model: readBy,
    },
  });
  const base = { replyId: reply.id, category: reading.category, summary: reading.summary, warnings };

  if (reading.category === "OTHER") {
    return { ...base, outcome: "recorded", message: "Reply saved on the invoice timeline. Nothing else changes." };
  }

  // The situation changed: pending or scheduled collection messages written before the reply are withdrawn.
  await withdrawPendingCollection(inv.id, now, `Client replied (${reading.category.toLowerCase().replaceAll("_", " ")}).`);

  if (reading.category === "PROMISE_TO_PAY") {
    const until = reading.promisedDate ?? "the date they gave";
    return {
      ...base,
      outcome: "reminders_paused",
      message: reading.promisedDate
        ? `Reminders paused until ${until}. The agent picks the invoice up again the day after if it's still unpaid.`
        : "Promise recorded, but no date was found, so reminders continue as usual.",
    };
  }

  const outstanding = Math.round((num(inv.amount) - num(inv.amountPaid)) * 100) / 100;
  const evidence = {
    now,
    receivedAt: now,
    summary: reading.summary,
    readBy,
    currency: inv.currency,
    amount: num(inv.amount),
    amountPaid: num(inv.amountPaid),
    payments: inv.payments.map((p) => ({ amount: num(p.amount), paidAt: p.paidAt })),
    contacts: contactHistory(inv),
    risk: (() => {
      const r = riskFor(inv, history, now);
      return r && { score: r.score, factors: r.factors };
    })(),
  };

  if (reading.category === "DISPUTE") {
    const actionId = await propose(inv, reply.id, now, {
      type: "ESCALATE",
      payload: {
        message: `${inv.project.client.name} disputes invoice ${inv.number}: "${reading.summary}" Read their reply on the invoice timeline and contact them personally; the agent won't send reminders meanwhile.`,
        stage: invoiceStage(inv.dueDate, now),
        tone: "internal",
        reply: { id: reply.id, text, category: reading.category, summary: reading.summary, warnings },
      },
      reasoning: `Client disputes the invoice: ${reading.summary}`,
      rationale: replyRationale({ ...evidence, category: "DISPUTE", action: "ESCALATE", model: null }),
    });
    return { ...base, outcome: "escalated", actionId, message: "Dispute flagged for you in the agent inbox." };
  }

  // HARDSHIP: code builds the plan within the limits.
  if (!inv.dueDate) throw new ReplyError("This invoice has no due date, so a payment plan can't be checked against your limits.");
  const limits = { minUpfrontPercent: settings.minUpfrontPercent, maxInstallments: settings.maxInstallments, maxDaysAfterDue: settings.maxDaysAfterDue };
  const result = buildPlan(reading.requestedPlan, { outstanding, currency: inv.currency, dueDate: inv.dueDate, now }, limits);
  const negotiation = {
    reply: { id: reply.id, text, category: reading.category, summary: reading.summary, warnings },
    requested: reading.requestedPlan,
    limits,
    outcome: result.outcome,
    checks: result.checks,
    plan: result.plan,
  };

  if (!result.plan) {
    const actionId = await propose(inv, reply.id, now, {
      type: "ESCALATE",
      payload: {
        message: `${inv.project.client.name} asked for a payment plan on ${inv.number}, but none fits your limits: ${result.reason} Consider calling them, or loosen your limits in Settings and paste the reply again.`,
        stage: invoiceStage(inv.dueDate, now),
        tone: "internal",
        negotiation,
      },
      reasoning: `Hardship reply, but no plan fits your limits: ${result.reason}`,
      rationale: replyRationale({ ...evidence, category: "HARDSHIP", action: "ESCALATE", limits, checks: result.checks, rejectedBecause: result.reason, model: null }),
    });
    return { ...base, outcome: "escalated", actionId, message: `No plan fits your limits (${result.reason}). Flagged for you instead.` };
  }

  const plan = result.plan;
  const planDetails = describePlan(plan, inv.currency);
  let draft: Draft;
  let model: string | null = null;
  try {
    ({ draft, model } = await writeCollectionMessage({
      action: "OFFER_PAYMENT_PLAN",
      tone: "empathetic",
      stage: invoiceStage(inv.dueDate, now),
      facts,
      planMinimum: plan.minimumAmount,
      planDetails,
      clientReply: text,
    }));
  } catch (e) {
    console.warn(`negotiation response failed; using template: ${e instanceof Error ? e.message : e}`);
    draft = templateResponse(inv, planDetails, result, settings.name);
  }

  const actionId = await propose(inv, reply.id, now, {
    type: "OFFER_PAYMENT_PLAN",
    payload: {
      subject: draft.subject ?? `A payment plan for invoice ${inv.number}`,
      message: draft.message,
      currency: inv.currency,
      installments: plan.installments.length,
      minimumAmount: plan.minimumAmount,
      stage: invoiceStage(inv.dueDate, now),
      tone: "empathetic",
      negotiation,
    },
    reasoning: draft.reasoning,
    rationale: replyRationale({ ...evidence, category: "HARDSHIP", action: "OFFER_PAYMENT_PLAN", limits, checks: result.checks, model }),
  });
  return {
    ...base,
    outcome: "plan_proposed",
    actionId,
    message:
      result.outcome === "clamped"
        ? "A payment plan adjusted to your limits is waiting for your approval."
        : "A payment plan within your limits is waiting for your approval.",
  };
}

async function withdrawPendingCollection(invoiceId: string, now: Date, reason: string) {
  await prisma.agentAction.updateMany({
    where: { invoiceId, type: { in: COLLECTION_ACTIONS }, status: { in: ["PROPOSED", "SCHEDULED"] } },
    data: { status: "REJECTED", decidedAt: now, pendingKey: null, scheduledFor: null, result: { superseded: true, reason } },
  });
}

async function propose(
  inv: AgentInvoice,
  replyId: string,
  now: Date,
  a: { type: "OFFER_PAYMENT_PLAN" | "ESCALATE"; payload: Record<string, unknown>; reasoning: string; rationale: unknown },
): Promise<string> {
  try {
    const action = await prisma.agentAction.create({
      data: {
        type: a.type,
        invoiceId: inv.id,
        payload: a.payload as Prisma.InputJsonValue,
        reasoning: a.reasoning,
        rationale: a.rationale as Prisma.InputJsonValue,
        isDemo: inv.isDemo,
        pendingKey: collectKey(inv.id),
        proposedAt: now,
      },
    });
    await prisma.clientReply.update({ where: { id: replyId }, data: { actionId: action.id } });
    return action.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ReplyError("A message for this invoice is being sent right now. The reply was saved; paste it again in a moment for a new proposal.", 409);
    }
    throw e;
  }
}

/** The plan in plain text, for Claude's prompt and the template. */
export function describePlan(plan: NonNullable<PlanOutcome["plan"]>, currency: string): string {
  return [
    ...plan.installments.map((x) => `Payment ${x.n} of ${plan.installments.length}: ${money(x.amount, currency)} by ${x.dueDate}`),
    `Total: ${money(plan.total, currency)}. The PayPal invoice will accept partial payments of at least ${money(plan.minimumAmount, currency)}.`,
  ].join("\n");
}

function templateResponse(inv: AgentInvoice, planDetails: string, result: PlanOutcome, signature: string): Draft {
  const first = inv.project.client.name.split(/\s+/)[0] || "there";
  const adjusted = result.outcome === "clamped" ? " I've adjusted the terms slightly so they work on my side too." : "";
  return {
    subject: `A payment plan for invoice ${inv.number}`,
    message: `Hi ${first},\n\nThanks for letting me know, and I understand. Here's a plan for invoice ${inv.number}:${adjusted}\n\n${planDetails}\n\nYou can pay each installment with the PayPal link in the invoice email. Just reply if anything here doesn't work.\n\nBest,\n${signature}`,
    reasoning: "Hardship reply; plan built within your limits; template used (AI unavailable).",
  };
}
