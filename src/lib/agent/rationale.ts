/**
 * "Why this action?": the facts behind a proposal, built ONLY from what the rules engine used
 * (never from AI output) and stored on the AgentAction when it's proposed, so the approver sees
 * exactly what the policy saw, even if the invoice changes later. Pure functions, no I/O.
 */
import { money, shortDate } from "@/lib/format";
import type { RiskFactor, Stage, Tone } from "./policy";

export const APPROVAL_NOTE = "Requires your approval. Nothing is sent until you click Approve.";
export const PAYOUT_APPROVAL_NOTE = "Requires your approval. No money moves until you click Approve payout.";

const STAGE_LABEL: Record<Stage, string> = {
  NOT_DUE: "Not due",
  DUE_SOON: "Due soon",
  OVERDUE: "Overdue",
  SERIOUSLY_OVERDUE: "Seriously overdue",
};

const ACTION_TEXT: Record<string, string> = {
  SEND_REMINDER: "Send reminder",
  OFFER_PAYMENT_PLAN: "Offer payment plan",
  ESCALATE: "Escalate to you",
  PAYOUT_SUBCONTRACTORS: "Pay subcontractors",
};

export interface ActionRationale {
  v: 1;
  /** Demo-clock time the rules evaluated the invoice. */
  evaluatedAt: string;
  trigger: string;
  evidence: {
    currency: string;
    amount: number;
    amountPaid: number;
    outstanding: number;
    payments: Array<{ amount: number; at: string }>;
    reminders: Array<{ type: string; at: string; subject: string | null }>;
    risk: { score: number; factors: RiskFactor[] } | null;
    hardshipSignal?: boolean;
    shares?: Array<{ name: string; amount: number; basis: string }>;
  };
  decision: {
    stage?: Stage;
    action: string;
    tone?: Tone;
    /** e.g. "Overdue → Send reminder → firm tone" */
    path: string;
    rule: string;
    details: string[];
  };
  /** Who wrote the words the client (or you) will read. */
  wording: { by: "claude" | "template"; label: string };
  safety: string;
}

const iso = (d: Date) => d.toISOString();
const day = (d: Date | string) => shortDate(d).replace(/, \d{4}$/, "");

export interface CollectionInput {
  now: Date;
  currency: string;
  amount: number;
  amountPaid: number;
  dueDate: Date;
  payments: Array<{ amount: number; paidAt: Date }>;
  contacts: Array<{ type: string; at: Date; subject: string | null }>;
  risk: { score: number; factors: RiskFactor[] } | null;
  hardshipSignal: boolean;
  assessment: { stage: Exclude<Stage, "NOT_DUE">; action: string; tone: Tone; rule: string; daysOverdue: number; outstanding: number };
  planMinimum?: number;
  /** Model id when Claude wrote the message, null when the template fallback did. */
  model: string | null;
}

export function collectionRationale(i: CollectionInput): ActionRationale {
  const a = i.assessment;
  const daysToDue = Math.ceil((i.dueDate.getTime() - i.now.getTime()) / 86_400_000);
  const when =
    a.daysOverdue > 0
      ? `${a.daysOverdue} day${a.daysOverdue === 1 ? "" : "s"} overdue`
      : daysToDue <= 0
        ? "Due today"
        : `Due in ${daysToDue} day${daysToDue === 1 ? "" : "s"}`;
  const trigger = `${when} (due ${day(i.dueDate)}, today ${day(i.now)} on the demo clock)`;

  const details: string[] = [];
  if (a.action === "OFFER_PAYMENT_PLAN" && i.planMinimum !== undefined) {
    details.push(`Minimum installment ${money(i.planMinimum, i.currency)}: about a third of the ${money(a.outstanding, i.currency)} outstanding, rounded up to 50.`);
  }
  if (i.hardshipSignal) details.push("The client's notes contain a financial-difficulty signal.");

  const tone = a.tone === "internal" ? "note for you, not the client" : `${a.tone} tone`;
  return {
    v: 1,
    evaluatedAt: iso(i.now),
    trigger,
    evidence: {
      currency: i.currency,
      amount: i.amount,
      amountPaid: i.amountPaid,
      outstanding: a.outstanding,
      payments: i.payments.map((p) => ({ amount: p.amount, at: iso(p.paidAt) })),
      reminders: i.contacts.map((c) => ({ type: c.type, at: iso(c.at), subject: c.subject })),
      risk: i.risk,
      hardshipSignal: i.hardshipSignal,
    },
    decision: {
      stage: a.stage,
      action: a.action,
      tone: a.tone,
      path: `${STAGE_LABEL[a.stage]} → ${ACTION_TEXT[a.action] ?? a.action} → ${tone}`,
      rule: a.rule,
      details,
    },
    wording: i.model
      ? { by: "claude", label: a.action === "ESCALATE" ? "Note written by Claude" : "Message written by Claude" }
      : { by: "template", label: "Message from a built-in template (Claude was unavailable)" },
    safety: APPROVAL_NOTE,
  };
}

export interface PayoutInput {
  now: Date;
  currency: string;
  amount: number;
  amountPaid: number;
  payments: Array<{ amount: number; paidAt: Date }>;
  shares: Array<{ name: string; amount: number; basis: string }>;
  model: string | null;
}

export function payoutRationale(i: PayoutInput): ActionRationale {
  const pct = i.amount > 0 ? Math.round((Math.min(i.amountPaid, i.amount) / i.amount) * 100) : 0;
  const last = i.payments.at(-1);
  const trigger = `Client has paid ${money(i.amountPaid, i.currency)} of ${money(i.amount, i.currency)} (${pct}%)${
    last ? `, last payment ${day(last.paidAt)}` : ""
  }`;
  return {
    v: 1,
    evaluatedAt: iso(i.now),
    trigger,
    evidence: {
      currency: i.currency,
      amount: i.amount,
      amountPaid: i.amountPaid,
      outstanding: Math.round((i.amount - i.amountPaid) * 100) / 100,
      payments: i.payments.map((p) => ({ amount: p.amount, at: iso(p.paidAt) })),
      reminders: [],
      risk: null,
      shares: i.shares,
    },
    decision: {
      action: "PAYOUT_SUBCONTRACTORS",
      path: `${pct}% paid → ${ACTION_TEXT.PAYOUT_SUBCONTRACTORS}`,
      rule: `Each subcontractor has earned ${pct}% of their agreed share, minus anything already paid out (rounded down to the cent, so nobody is overpaid).`,
      details: [],
    },
    wording: i.model
      ? { by: "claude", label: "Explanation written by Claude" }
      : { by: "template", label: "Explanation from a built-in template (Claude was unavailable)" },
    safety: PAYOUT_APPROVAL_NOTE,
  };
}

export interface ReplyInput {
  now: Date;
  receivedAt: Date;
  category: "HARDSHIP" | "DISPUTE";
  summary: string;
  /** Model id that read the reply; null when the keyword fallback did. */
  readBy: string | null;
  currency: string;
  amount: number;
  amountPaid: number;
  payments: Array<{ amount: number; paidAt: Date }>;
  contacts: Array<{ type: string; at: Date; subject: string | null }>;
  risk: { score: number; factors: RiskFactor[] } | null;
  action: "OFFER_PAYMENT_PLAN" | "ESCALATE";
  /** Plan proposals: the limits and the code's rule-by-rule checks. */
  limits?: { minUpfrontPercent: number; maxInstallments: number; maxDaysAfterDue: number };
  checks?: Array<{ rule: string; requested: string; result: "pass" | "clamped" | "fail"; applied: string }>;
  rejectedBecause?: string;
  /** Model id when Claude wrote the response, null for the template. */
  model: string | null;
}

const CHECK_MARK = { pass: "✓", clamped: "Adjusted:", fail: "✗" } as const;

/** Rationale for a proposal made from a client's reply (hardship -> plan, dispute or no valid plan -> escalate). */
export function replyRationale(i: ReplyInput): ActionRationale {
  const readBy = i.readBy ? "Claude" : "keyword matching (AI unavailable)";
  const label = i.category === "HARDSHIP" ? "financial hardship" : "a dispute";
  const details = (i.checks ?? []).map((c) =>
    c.result === "pass" ? `${CHECK_MARK.pass} ${c.rule}: ${c.applied}` : `${CHECK_MARK[c.result]} ${c.rule}: asked ${c.requested}, ${c.result === "fail" ? "not possible" : `set to ${c.applied}`}`,
  );
  const plan = i.action === "OFFER_PAYMENT_PLAN";
  const rule = plan
    ? `The plan was built by code from your limits (at least ${i.limits!.minUpfrontPercent}% upfront, at most ${i.limits!.maxInstallments} payments, last payment within ${i.limits!.maxDaysAfterDue} days of the due date). Claude only read the reply; it can't change these terms.`
    : i.rejectedBecause
      ? `No payment plan fits your limits (${i.rejectedBecause}), so it's handed to you instead of the agent offering terms you didn't allow.`
      : "Disputes need a person: the agent stops chasing and hands it to you.";
  return {
    v: 1,
    evaluatedAt: iso(i.now),
    trigger: `Client replied on ${day(i.receivedAt)}; ${readBy} read it as ${label}: "${i.summary}"`,
    evidence: {
      currency: i.currency,
      amount: i.amount,
      amountPaid: i.amountPaid,
      outstanding: Math.round((i.amount - i.amountPaid) * 100) / 100,
      payments: i.payments.map((p) => ({ amount: p.amount, at: iso(p.paidAt) })),
      reminders: i.contacts.map((c) => ({ type: c.type, at: iso(c.at), subject: c.subject })),
      risk: i.risk,
    },
    decision: {
      action: i.action,
      tone: plan ? "empathetic" : "internal",
      path: plan ? "Hardship reply → Offer payment plan → empathetic tone" : `${i.category === "HARDSHIP" ? "Hardship reply, no plan within limits" : "Dispute"} → Escalate to you → note for you, not the client`,
      rule,
      details,
    },
    wording: plan
      ? i.model
        ? { by: "claude", label: "Response written by Claude, for the plan above" }
        : { by: "template", label: "Response from a built-in template (Claude was unavailable)" }
      : { by: "template", label: "Note generated from the rules" },
    safety: APPROVAL_NOTE,
  };
}

/** Narrow an AgentAction.rationale JSON value (null for actions proposed before this existed). */
export function asRationale(v: unknown): ActionRationale | null {
  return v && typeof v === "object" && (v as { v?: unknown }).v === 1 ? (v as ActionRationale) : null;
}
