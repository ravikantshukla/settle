/**
 * Deterministic collection rules: WHICH invoices need attention and WHICH actions are allowed.
 * Claude then picks among the allowed actions and writes the message. Pure functions, no I/O.
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
  hasPendingAction: boolean;
  lastRejectedAt: Date | null;
  hardshipSignal: boolean;
}

export type Stage = "DUE_SOON" | "OVERDUE" | "SERIOUSLY_OVERDUE";

export type Assessment =
  | { attention: false; reason: string; daysOverdue: number; outstanding: number }
  | {
      attention: true;
      stage: Stage;
      allowedActions: AgentActionType[];
      reason: string;
      daysOverdue: number;
      outstanding: number;
    };

const daysBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / DAY_MS;

export function daysOverdue(dueDate: Date | null, now: Date): number {
  return dueDate ? Math.floor(daysBetween(dueDate, now)) : 0;
}

export function assessInvoice(f: InvoiceFacts, now: Date): Assessment {
  const outstanding = Math.round((f.amount - f.amountPaid) * 100) / 100;
  const overdue = daysOverdue(f.dueDate, now);
  const skip = (reason: string): Assessment => ({ attention: false, reason, daysOverdue: overdue, outstanding });

  if (!COLLECTIBLE_STATUSES.includes(f.status)) return skip(`status ${f.status}`);
  if (outstanding <= 0) return skip("nothing outstanding");
  if (f.hasPendingAction) return skip("a proposal is already waiting for approval");
  if (f.lastRejectedAt && daysBetween(f.lastRejectedAt, now) < POLICY.rejectionCooldownDays) {
    return skip("a proposal was rejected recently");
  }
  if (!f.dueDate) return skip("no due date");

  const sinceContact = f.lastContactAt ? daysBetween(f.lastContactAt, now) : Infinity;

  if (overdue <= 0) {
    const daysUntilDue = Math.ceil(daysBetween(now, f.dueDate));
    if (daysUntilDue > POLICY.dueSoonDays) return skip(`due in ${daysUntilDue} days`);
    if (sinceContact < POLICY.nudgeCooldownDays) return skip("nudged recently");
    return {
      attention: true,
      stage: "DUE_SOON",
      allowedActions: ["SEND_REMINDER"],
      reason: daysUntilDue <= 0 ? "due today" : `due in ${daysUntilDue} day(s)`,
      daysOverdue: overdue,
      outstanding,
    };
  }

  if (sinceContact < POLICY.reminderCooldownDays) {
    return skip(`contacted ${Math.floor(sinceContact)} day(s) ago`);
  }

  const serious = overdue >= POLICY.paymentPlanAfterDays;
  const allowed: AgentActionType[] = ["SEND_REMINDER"];
  if ((serious || f.hardshipSignal) && !f.planOffered && !f.allowPartial) allowed.unshift("OFFER_PAYMENT_PLAN");
  if (overdue >= POLICY.escalateAfterDays && (f.planOffered || f.reminderCount >= 2)) allowed.push("ESCALATE");

  return {
    attention: true,
    stage: serious ? "SERIOUSLY_OVERDUE" : "OVERDUE",
    allowedActions: allowed,
    reason: `${overdue} day(s) overdue${f.hardshipSignal ? ", hardship signal in notes" : ""}`,
    daysOverdue: overdue,
    outstanding,
  };
}

/** A sensible payment-plan minimum: ~a third of what's outstanding, rounded up to 50. */
export function suggestedMinimum(outstanding: number): number {
  if (outstanding <= 100) return Math.round(outstanding * 100) / 100;
  return Math.min(outstanding, Math.ceil(outstanding / 3 / 50) * 50);
}
