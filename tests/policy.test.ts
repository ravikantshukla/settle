import { describe, expect, it } from "vitest";
import { assessInvoice, hasHardshipSignal, invoiceStage, riskScore, suggestedMinimum, type InvoiceFacts, type RiskInput } from "@/lib/agent/policy";

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
    pendingAction: null,
    lastRejectedAt: null,
    hardshipSignal: false,
    ...overrides,
  };
}

const decide = (f: InvoiceFacts) => {
  const a = assessInvoice(f, NOW);
  return a.attention ? { action: a.action, tone: a.tone, stage: a.stage } : null;
};

describe("invoiceStage (rules)", () => {
  it.each([
    [-10, "NOT_DUE"],
    [-4, "NOT_DUE"],
    [-3, "DUE_SOON"],
    [0, "DUE_SOON"],
    [1, "OVERDUE"],
    [29, "OVERDUE"],
    [30, "SERIOUSLY_OVERDUE"],
    [90, "SERIOUSLY_OVERDUE"],
  ] as const)("%i days past due -> %s", (overdueDays, stage) => {
    expect(invoiceStage(daysAgo(overdueDays), NOW)).toBe(stage);
  });

  it("no due date is never overdue", () => {
    expect(invoiceStage(null, NOW)).toBe("NOT_DUE");
  });
});

describe("which invoices need attention", () => {
  it("ignores invoices that are paid, cancelled or drafts", () => {
    for (const status of ["PAID", "MARKED_AS_PAID", "CANCELLED", "DRAFT", "REFUNDED"] as const) {
      expect(assessInvoice(facts({ status }), NOW).attention).toBe(false);
    }
  });

  it("ignores invoices with nothing outstanding", () => {
    expect(assessInvoice(facts({ amountPaid: 1000 }), NOW)).toMatchObject({ attention: false, reason: "nothing outstanding" });
  });

  it("leaves invoices that aren't due soon alone", () => {
    expect(assessInvoice(facts({ dueDate: daysAgo(-10) }), NOW)).toMatchObject({ attention: false, reason: "due in 10 days" });
  });

  it("backs off after the user rejected a proposal recently", () => {
    expect(assessInvoice(facts({ lastRejectedAt: daysAgo(1) }), NOW).attention).toBe(false);
    expect(assessInvoice(facts({ lastRejectedAt: daysAgo(4) }), NOW).attention).toBe(true);
  });

  it("respects contact cooldowns (2 days before due, 7 days after)", () => {
    expect(assessInvoice(facts({ dueDate: daysAgo(-2), lastContactAt: daysAgo(1) }), NOW).attention).toBe(false);
    expect(assessInvoice(facts({ lastContactAt: daysAgo(3) }), NOW).attention).toBe(false);
    expect(assessInvoice(facts({ lastContactAt: daysAgo(8) }), NOW).attention).toBe(true);
  });
});

describe("which action and tone (rules decide; Claude only writes)", () => {
  it("due soon -> friendly reminder", () => {
    expect(decide(facts({ dueDate: daysAgo(-2) }))).toEqual({ action: "SEND_REMINDER", tone: "friendly", stage: "DUE_SOON" });
  });

  it("1-29 days overdue -> firm reminder", () => {
    expect(decide(facts({ dueDate: daysAgo(7) }))).toEqual({ action: "SEND_REMINDER", tone: "firm", stage: "OVERDUE" });
  });

  it("30+ days overdue -> payment plan (empathetic)", () => {
    expect(decide(facts({ dueDate: daysAgo(35) }))).toEqual({ action: "OFFER_PAYMENT_PLAN", tone: "empathetic", stage: "SERIOUSLY_OVERDUE" });
  });

  it("hardship signal -> payment plan before 30 days", () => {
    expect(decide(facts({ dueDate: daysAgo(12), hardshipSignal: true }))?.action).toBe("OFFER_PAYMENT_PLAN");
  });

  it("no second payment plan once offered or when partial payments are already on", () => {
    expect(decide(facts({ dueDate: daysAgo(35), planOffered: true, lastContactAt: daysAgo(10) }))?.action).toBe("SEND_REMINDER");
    expect(decide(facts({ dueDate: daysAgo(35), allowPartial: true }))?.action).toBe("SEND_REMINDER");
  });

  it("45+ days after a plan or two reminders -> escalate internally", () => {
    expect(decide(facts({ dueDate: daysAgo(50), planOffered: true, lastContactAt: daysAgo(10) }))).toMatchObject({ action: "ESCALATE", tone: "internal" });
    expect(decide(facts({ dueDate: daysAgo(50), reminderCount: 2, lastContactAt: daysAgo(10) }))?.action).toBe("ESCALATE");
    expect(decide(facts({ dueDate: daysAgo(50) }))?.action).toBe("OFFER_PAYMENT_PLAN");
  });

  it("partially paid invoices are chased for the remainder", () => {
    expect(assessInvoice(facts({ status: "PARTIALLY_PAID", amountPaid: 400 }), NOW)).toMatchObject({ attention: true, outstanding: 600 });
  });
});

describe("no duplicate proposals", () => {
  it("skips when the same proposal is already pending", () => {
    const pending = { type: "SEND_REMINDER" as const, stage: "OVERDUE" as const };
    expect(assessInvoice(facts({ dueDate: daysAgo(7), pendingAction: pending }), NOW)).toMatchObject({
      attention: false,
      reason: "a proposal is already waiting for approval",
    });
  });

  it("supersedes a pending proposal when the situation escalated (e.g. +30 days)", () => {
    const pending = { type: "SEND_REMINDER" as const, stage: "OVERDUE" as const };
    expect(assessInvoice(facts({ dueDate: daysAgo(37), pendingAction: pending }), NOW)).toMatchObject({
      attention: true,
      action: "OFFER_PAYMENT_PLAN",
      supersedes: true,
    });
  });
});

describe("riskScore (rules)", () => {
  const base: RiskInput = {
    status: "SENT",
    dueDate: daysAgo(-10),
    amount: 1000,
    amountPaid: 0,
    reminderCount: 0,
    planOffered: false,
    hardshipSignal: false,
    history: null,
  };
  const score = (o: Partial<RiskInput>) => riskScore({ ...base, ...o }, NOW)!.score;

  it("is null for invoices that can't be collected", () => {
    expect(riskScore({ ...base, status: "PAID" }, NOW)).toBeNull();
    expect(riskScore({ ...base, amountPaid: 1000 }, NOW)).toBeNull();
  });

  it("is low before the due date and rises with lateness", () => {
    const notDue = score({});
    const late10 = score({ dueDate: daysAgo(10) });
    const late40 = score({ dueDate: daysAgo(40) });
    const late90 = score({ dueDate: daysAgo(90) });
    expect(notDue).toBeLessThan(15);
    expect(late10).toBeGreaterThan(notDue);
    expect(late40).toBeGreaterThan(late10);
    expect(late90).toBeGreaterThan(late40);
    expect(late90).toBeLessThanOrEqual(100);
  });

  it("goes down with partial payments and good history, up with hardship and ignored reminders", () => {
    const late = { dueDate: daysAgo(20) };
    expect(score({ ...late, amountPaid: 500 })).toBeLessThan(score(late));
    expect(score({ ...late, hardshipSignal: true })).toBeGreaterThan(score(late));
    expect(score({ ...late, reminderCount: 2 })).toBeGreaterThan(score(late));
    const reliable = { paidInvoices: 4, averageDaysLate: -2, paidOnTime: 4, otherOpenInvoices: 0 };
    const slow = { paidInvoices: 4, averageDaysLate: 25, paidOnTime: 0, otherOpenInvoices: 0 };
    expect(score({ ...late, history: reliable })).toBeLessThan(score({ ...late, history: slow }));
  });

  it("stays within 0-100 and explains itself", () => {
    const worst = riskScore({ ...base, dueDate: daysAgo(400), hardshipSignal: true, reminderCount: 9, planOffered: true }, NOW)!;
    expect(worst.score).toBeLessThanOrEqual(100);
    expect(worst.drivers[0]).toMatch(/days overdue/);
    expect(score({ amountPaid: 990, history: { paidInvoices: 3, averageDaysLate: 0, paidOnTime: 3, otherOpenInvoices: 0 } })).toBeGreaterThanOrEqual(0);
  });
});

describe("helpers", () => {
  it("detects hardship language in client notes", () => {
    expect(hasHardshipSignal("Mentioned cash-flow issues during the last call.")).toBe(true);
    expect(hasHardshipSignal("Pays reliably, usually within a week.")).toBe(false);
  });

  it("suggests a payment-plan minimum of about a third, rounded up to 50", () => {
    expect(suggestedMinimum(9750)).toBe(3250);
    expect(suggestedMinimum(80)).toBe(80);
  });
});
