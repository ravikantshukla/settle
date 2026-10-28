import { describe, expect, it } from "vitest";
import { assessInvoice, hasHardshipSignal, suggestedMinimum, type InvoiceFacts } from "@/lib/agent/policy";

const NOW = new Date("2026-11-01T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function facts(overrides: Partial<InvoiceFacts> = {}): InvoiceFacts {
  return {
    status: "SENT",
    dueDate: daysAgo(10),
    amount: 1000,
    amountPaid: 0,
    allowPartial: false,
    lastContactAt: null,
    reminderCount: 0,
    planOffered: false,
    hasPendingAction: false,
    lastRejectedAt: null,
    hardshipSignal: false,
    ...overrides,
  };
}

const allowed = (f: InvoiceFacts) => {
  const a = assessInvoice(f, NOW);
  return a.attention ? a.allowedActions : null;
};

describe("which invoices need attention", () => {
  it("ignores invoices that are paid, cancelled or drafts", () => {
    for (const status of ["PAID", "MARKED_AS_PAID", "CANCELLED", "DRAFT", "REFUNDED"] as const) {
      expect(assessInvoice(facts({ status }), NOW).attention).toBe(false);
    }
  });

  it("ignores invoices with nothing outstanding", () => {
    expect(assessInvoice(facts({ amountPaid: 1000 }), NOW)).toMatchObject({ attention: false, reason: "nothing outstanding" });
  });

  it("never stacks a second proposal on a pending one", () => {
    expect(assessInvoice(facts({ hasPendingAction: true }), NOW)).toMatchObject({ attention: false });
  });

  it("backs off after the user rejected a proposal recently", () => {
    expect(assessInvoice(facts({ lastRejectedAt: daysAgo(1) }), NOW).attention).toBe(false);
    expect(assessInvoice(facts({ lastRejectedAt: daysAgo(4) }), NOW).attention).toBe(true);
  });

  it("leaves invoices that are not due soon alone", () => {
    expect(assessInvoice(facts({ dueDate: daysAgo(-10) }), NOW)).toMatchObject({ attention: false, reason: "due in 10 days" });
  });

  it("skips invoices without a due date", () => {
    expect(assessInvoice(facts({ dueDate: null }), NOW).attention).toBe(false);
  });
});

describe("which action types are allowed", () => {
  it("due within 3 days -> friendly nudge only", () => {
    const a = assessInvoice(facts({ dueDate: daysAgo(-2) }), NOW);
    expect(a).toMatchObject({ attention: true, stage: "DUE_SOON", allowedActions: ["SEND_REMINDER"] });
  });

  it("does not nudge twice in two days", () => {
    expect(assessInvoice(facts({ dueDate: daysAgo(-2), lastContactAt: daysAgo(1) }), NOW).attention).toBe(false);
  });

  it("1-29 days overdue -> firm reminder only", () => {
    const a = assessInvoice(facts({ dueDate: daysAgo(10) }), NOW);
    expect(a).toMatchObject({ stage: "OVERDUE", allowedActions: ["SEND_REMINDER"] });
  });

  it("respects the 7-day reminder cooldown", () => {
    expect(assessInvoice(facts({ lastContactAt: daysAgo(3) }), NOW).attention).toBe(false);
    expect(assessInvoice(facts({ lastContactAt: daysAgo(8) }), NOW).attention).toBe(true);
  });

  it("30+ days overdue -> payment plan offered first", () => {
    const a = assessInvoice(facts({ dueDate: daysAgo(35) }), NOW);
    expect(a).toMatchObject({ stage: "SERIOUSLY_OVERDUE", allowedActions: ["OFFER_PAYMENT_PLAN", "SEND_REMINDER"] });
  });

  it("a hardship signal unlocks a payment plan before 30 days", () => {
    expect(allowed(facts({ dueDate: daysAgo(12), hardshipSignal: true }))).toEqual(["OFFER_PAYMENT_PLAN", "SEND_REMINDER"]);
  });

  it("no second payment plan once one was offered or partial payments are already on", () => {
    expect(allowed(facts({ dueDate: daysAgo(35), planOffered: true, lastContactAt: daysAgo(10) }))).toEqual(["SEND_REMINDER"]);
    expect(allowed(facts({ dueDate: daysAgo(35), allowPartial: true }))).toEqual(["SEND_REMINDER"]);
  });

  it("45+ days overdue after a plan or two reminders -> escalation is allowed", () => {
    expect(allowed(facts({ dueDate: daysAgo(50), planOffered: true, lastContactAt: daysAgo(10) }))).toEqual(["SEND_REMINDER", "ESCALATE"]);
    expect(allowed(facts({ dueDate: daysAgo(50), reminderCount: 2, lastContactAt: daysAgo(10) }))).toContain("ESCALATE");
    expect(allowed(facts({ dueDate: daysAgo(50) }))).not.toContain("ESCALATE");
  });

  it("partially paid invoices are still chased for the remainder", () => {
    const a = assessInvoice(facts({ status: "PARTIALLY_PAID", amountPaid: 400 }), NOW);
    expect(a).toMatchObject({ attention: true, outstanding: 600 });
  });
});

describe("helpers", () => {
  it("detects hardship language in client notes", () => {
    expect(hasHardshipSignal("Mentioned cash-flow issues during the last call.")).toBe(true);
    expect(hasHardshipSignal("Asked to pay in installments")).toBe(true);
    expect(hasHardshipSignal("Pays reliably, usually within a week.")).toBe(false);
    expect(hasHardshipSignal(null, undefined)).toBe(false);
  });

  it("suggests a payment-plan minimum of about a third, rounded up to 50", () => {
    expect(suggestedMinimum(9750)).toBe(3250);
    expect(suggestedMinimum(1000)).toBe(350);
    expect(suggestedMinimum(80)).toBe(80);
  });
});
