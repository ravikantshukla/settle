/**
 * Deterministic collection rules. Pure functions, no I/O.
 *
 * The rules decide each invoice's stage, the ONE next action and its tone, and the risk score.
 * Claude only writes the wording (subject, message, one-line reasoning / risk reason).
 */
import type { AgentActionType, InvoiceStatus } from "@prisma/client";

export const DAY_MS = 86_400_000;

export const POLICY = {
  dueSoonDays: 3,
  nudgeCooldownDays: 2,
  reminderCooldownDays: 7,
  rejectionCooldownDays: 3,
  paymentPlanAfterDays: 30,
  escalateAfterDays: 45,
} as const;

/** Statuses where the client still owes money and PayPal accepts reminders. */
export const COLLECTIBLE_STATUSES: InvoiceStatus[] = ["SENT", "UNPAID", "PARTIALLY_PAID", "PAYMENT_PENDING"];

export const COLLECTION_ACTIONS: AgentActionType[] = ["SEND_REMINDER", "OFFER_PAYMENT_PLAN", "ESCALATE"];

const HARDSHIP = /cash[\s-]?flow|hardship|tight (budget|month)|struggl|installment|can'?t (afford|pay)|lay-?offs?|funding (delay|gap)/i;

export function hasHardshipSignal(...texts: Array<string | null | undefined>): boolean {
  return texts.some((t) => !!t && HARDSHIP.test(t));
}

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

export type Stage = "NOT_DUE" | "DUE_SOON" | "OVERDUE" | "SERIOUSLY_OVERDUE";

const daysBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / DAY_MS;

export function daysOverdue(dueDate: Date | null, now: Date): number {
  return dueDate ? Math.floor(daysBetween(dueDate, now)) : 0;
}

/** Stage from the due date alone. No due date counts as not due. */
export function invoiceStage(dueDate: Date | null, now: Date): Stage {
  if (!dueDate) return "NOT_DUE";
  const overdue = daysOverdue(dueDate, now);
  if (overdue >= POLICY.paymentPlanAfterDays) return "SERIOUSLY_OVERDUE";
  if (overdue >= 1) return "OVERDUE";
  return Math.ceil(daysBetween(now, dueDate)) <= POLICY.dueSoonDays ? "DUE_SOON" : "NOT_DUE";
}

// ---------------------------------------------------------------------------
// Next action
// ---------------------------------------------------------------------------

export type Tone = "friendly" | "firm" | "empathetic" | "internal";

export interface InvoiceFacts {
  status: InvoiceStatus;
  dueDate: Date | null;
  amount: number;
  amountPaid: number;
  allowPartial: boolean;
  /** Last executed reminder or payment-plan offer. */
  lastContactAt: Date | null;
  reminderCount: number;
  planOffered: boolean;
  /** The collection proposal currently awaiting approval, if any. */
  pendingAction: { type: AgentActionType; stage: Stage | null } | null;
  lastRejectedAt: Date | null;
  hardshipSignal: boolean;
}

export type Assessment =
  | { attention: false; stage: Stage; reason: string; daysOverdue: number; outstanding: number }
  | {
      attention: true;
      stage: Exclude<Stage, "NOT_DUE">;
      action: Extract<AgentActionType, "SEND_REMINDER" | "OFFER_PAYMENT_PLAN" | "ESCALATE">;
      tone: Tone;
      reason: string;
      daysOverdue: number;
      outstanding: number;
      /** A pending proposal that this one replaces because the situation escalated. */
      supersedes: boolean;
    };

export function assessInvoice(f: InvoiceFacts, now: Date): Assessment {
  const outstanding = Math.round((f.amount - f.amountPaid) * 100) / 100;
  const overdue = daysOverdue(f.dueDate, now);
  const stage = invoiceStage(f.dueDate, now);
  const skip = (reason: string): Assessment => ({ attention: false, stage, reason, daysOverdue: overdue, outstanding });

  if (!COLLECTIBLE_STATUSES.includes(f.status)) return skip(`status ${f.status}`);
  if (outstanding <= 0) return skip("nothing outstanding");
  if (!f.dueDate) return skip("no due date");
  if (stage === "NOT_DUE") return skip(`due in ${Math.ceil(daysBetween(now, f.dueDate))} days`);
  if (f.lastRejectedAt && daysBetween(f.lastRejectedAt, now) < POLICY.rejectionCooldownDays) {
    return skip("a proposal was rejected recently");
  }

  const sinceContact = f.lastContactAt ? daysBetween(f.lastContactAt, now) : Infinity;
  const cooldown = stage === "DUE_SOON" ? POLICY.nudgeCooldownDays : POLICY.reminderCooldownDays;
  if (sinceContact < cooldown) return skip(`contacted ${Math.floor(sinceContact)} day(s) ago`);

  let action: Extract<AgentActionType, "SEND_REMINDER" | "OFFER_PAYMENT_PLAN" | "ESCALATE">;
  let tone: Tone;
  const planAvailable = !f.planOffered && !f.allowPartial;
  if (stage === "DUE_SOON") {
    action = "SEND_REMINDER";
    tone = "friendly";
  } else if (overdue >= POLICY.escalateAfterDays && (f.planOffered || f.reminderCount >= 2)) {
    action = "ESCALATE";
    tone = "internal";
  } else if ((stage === "SERIOUSLY_OVERDUE" || f.hardshipSignal) && planAvailable) {
    action = "OFFER_PAYMENT_PLAN";
    tone = "empathetic";
  } else {
    action = "SEND_REMINDER";
    tone = "firm";
  }

  // One pending proposal per invoice: keep it if it still fits, replace it if things escalated.
  let supersedes = false;
  if (f.pendingAction) {
    if (f.pendingAction.type === action && f.pendingAction.stage === stage) return skip("a proposal is already waiting for approval");
    supersedes = true;
  }

  const when = stage === "DUE_SOON" ? (overdue === 0 ? "due today" : `due in ${Math.ceil(daysBetween(now, f.dueDate))} day(s)`) : `${overdue} day(s) overdue`;
  return {
    attention: true,
    stage,
    action,
    tone,
    reason: `${when}${f.hardshipSignal ? ", hardship signal in notes" : ""}`,
    daysOverdue: overdue,
    outstanding,
    supersedes,
  };
}

/** A sensible payment-plan minimum: ~a third of what's outstanding, rounded up to 50. */
export function suggestedMinimum(outstanding: number): number {
  if (outstanding <= 100) return Math.round(outstanding * 100) / 100;
  return Math.min(outstanding, Math.ceil(outstanding / 3 / 50) * 50);
}

// ---------------------------------------------------------------------------
// Risk score
// ---------------------------------------------------------------------------

export interface RiskInput {
  status: InvoiceStatus;
  dueDate: Date | null;
  amount: number;
  amountPaid: number;
  reminderCount: number;
  planOffered: boolean;
  hardshipSignal: boolean;
  history: { paidInvoices: number; averageDaysLate: number | null; paidOnTime: number; otherOpenInvoices: number } | null;
}

export interface RiskScore {
  score: number;
  /** Human-readable drivers, most important first (used for the fallback reason and given to Claude). */
  drivers: string[];
}

/** 0 = will be paid on time, 100 = very unlikely to be paid. Null for invoices that aren't collectible. */
export function riskScore(r: RiskInput, now: Date): RiskScore | null {
  if (!COLLECTIBLE_STATUSES.includes(r.status) || r.amount - r.amountPaid <= 0) return null;
  const drivers: Array<[weight: number, text: string]> = [];
  let score = 5;

  const overdue = daysOverdue(r.dueDate, now);
  if (overdue > 0) {
    const pts = overdue <= 30 ? 15 + overdue : overdue <= 60 ? 45 + (overdue - 30) * 0.5 : Math.min(75, 60 + (overdue - 60) * 0.25);
    score += pts;
    drivers.push([pts, `${overdue} days overdue`]);
  } else if (invoiceStage(r.dueDate, now) === "DUE_SOON") {
    score += 5;
    drivers.push([5, "due within days"]);
  }

  const paidFraction = r.amount > 0 ? r.amountPaid / r.amount : 0;
  if (paidFraction > 0) {
    const pts = -Math.round(20 * paidFraction);
    score += pts;
    drivers.push([-pts, `${Math.round(paidFraction * 100)}% already paid`]);
  }
  if (r.hardshipSignal) {
    score += 15;
    drivers.push([15, "client mentioned financial difficulty"]);
  }
  if (overdue > 0 && r.reminderCount > 0) {
    const pts = Math.min(15, r.reminderCount * 5);
    score += pts;
    drivers.push([pts, `${r.reminderCount} reminder(s) without full payment`]);
  }
  if (r.planOffered && paidFraction === 0 && overdue > 0) {
    score += 5;
    drivers.push([5, "payment plan offered, nothing paid yet"]);
  }

  const h = r.history;
  if (h && h.paidInvoices > 0) {
    if ((h.averageDaysLate ?? 0) > 10) {
      score += 10;
      drivers.push([10, `usually pays ~${h.averageDaysLate} days late`]);
    } else if (h.paidOnTime === h.paidInvoices) {
      score -= 10;
      drivers.push([10, "has always paid on time"]);
    }
  } else if (!h || h.paidInvoices === 0) {
    drivers.push([1, "no payment history with this client"]);
  }
  if (h && h.otherOpenInvoices > 0 && overdue > 0) {
    score += 5;
    drivers.push([5, `${h.otherOpenInvoices} other unpaid invoice(s)`]);
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    drivers: drivers.sort((a, b) => b[0] - a[0]).map(([, t]) => t),
  };
}
