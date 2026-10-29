/**
 * Client-timezone scheduling and payment-plan negotiation, end to end against a real (temporary)
 * SQLite database. Claude and PayPal are mocked; only `Date` is faked so the clock is deterministic.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "settle-neg-"));
process.env.DATABASE_URL = `file:${join(dir, "test.db").replace(/\\/g, "/")}`;

const remindInvoice = vi.fn(async () => undefined);
const enablePartialPayment = vi.fn(async () => ({}));
vi.mock("@/lib/paypal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/paypal")>()),
  remindInvoice: (...a: unknown[]) => remindInvoice(...(a as [])),
  enablePartialPayment: (...a: unknown[]) => enablePartialPayment(...(a as [])),
}));

const writeCollectionMessage = vi.fn();
vi.mock("@/lib/ai/collectionDecision", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/collectionDecision")>()),
  writeCollectionMessage: (...a: unknown[]) => writeCollectionMessage(...a),
}));
const readClientReply = vi.fn();
vi.mock("@/lib/ai/clientReply", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/clientReply")>()),
  readClientReply: (...a: unknown[]) => readClientReply(...a),
}));
vi.mock("@/lib/ai/riskScore", () => ({ writeRiskReasons: vi.fn(async () => Promise.reject(new Error("AI down"))) }));

type Mod<T extends string> = T extends "@/lib/db" ? typeof import("@/lib/db") : never;
let prisma: Mod<"@/lib/db">["prisma"];
let agent: typeof import("@/lib/agent");
let handleClientReply: typeof import("@/lib/negotiation/handleReply").handleClientReply;
let saveSettings: typeof import("@/lib/settings").saveSettings;

const WED_0630_NEW_YORK = new Date("2026-10-28T10:30:00Z");
const DAY = 86_400_000;

beforeAll(async () => {
  execSync("npx prisma migrate deploy", { env: { ...process.env }, stdio: "ignore" });
  ({ prisma } = await import("@/lib/db"));
  agent = await import("@/lib/agent");
  ({ handleClientReply } = await import("@/lib/negotiation/handleReply"));
  ({ saveSettings } = await import("@/lib/settings"));
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(WED_0630_NEW_YORK);
  for (const m of [prisma.clientReply, prisma.agentRunLog, prisma.agentAction, prisma.invoiceRisk, prisma.invoicePayment, prisma.invoice, prisma.project, prisma.client, prisma.appSetting]) {
    await (m as { deleteMany: () => Promise<unknown> }).deleteMany();
  }
  await saveSettings({ name: "Aarav Mishra", city: "Lucknow, India", timezone: "Asia/Kolkata", minUpfrontPercent: 25, maxInstallments: 4, maxDaysAfterDue: 60 });
  remindInvoice.mockClear();
  enablePartialPayment.mockClear();
  readClientReply.mockReset();
  writeCollectionMessage.mockReset().mockImplementation(async (input: { tone: string; planDetails?: string }) => ({
    model: "mock",
    draft: { subject: `${input.tone} subject`, message: input.planDetails ? `Plan offered:\n${input.planDetails}` : `${input.tone} message`, reasoning: "because" },
  }));
});

afterEach(() => vi.useRealTimers());

async function createInvoice(opts: { dueInDays: number; amount?: number; timezone?: string; country?: string }) {
  const client = await prisma.client.create({
    data: { name: "Emily Carter", email: "emily@hudsonpike.example", company: "Hudson & Pike Coffee", timezone: opts.timezone, country: opts.country },
  });
  const project = await prisma.project.create({ data: { clientId: client.id, title: "Brand refresh" } });
  return prisma.invoice.create({
    data: {
      projectId: project.id,
      number: `INV-${Math.random().toString(36).slice(2, 8)}`,
      paypalInvoiceId: `INV2-${Math.random().toString(36).slice(2, 8)}`,
      status: "SENT",
      amount: opts.amount ?? 8000,
      issueDate: new Date(WED_0630_NEW_YORK.getTime() - 30 * DAY),
      sentAt: new Date(WED_0630_NEW_YORK.getTime() - 30 * DAY),
      dueDate: new Date(WED_0630_NEW_YORK.getTime() + opts.dueInDays * DAY),
    },
  });
}

const proposed = () => prisma.agentAction.findMany({ where: { status: "PROPOSED" } });

describe("reminders wait for the client's business hours", () => {
  it("schedules for 9:00 New York time, then sends when the window opens", async () => {
    await createInvoice({ dueInDays: -5, timezone: "America/New_York", country: "US" });
    await agent.runAgent("manual");
    const [a] = await proposed();
    expect(a.type).toBe("SEND_REMINDER");

    const r = await agent.executeAction(a.id);
    expect(r.status).toBe("SCHEDULED");
    expect(r.message).toBe("Approved. Sends at 9:00 AM client time (6:30 PM IST).");
    expect(remindInvoice).not.toHaveBeenCalled();
    expect(await agent.dispatchScheduledActions()).toEqual([]); // not 9:00 yet

    vi.setSystemTime(new Date("2026-10-28T13:05:00Z")); // 9:05 in New York
    await agent.runAgent("scheduled");
    expect(remindInvoice).toHaveBeenCalledTimes(1);
    expect(await prisma.agentAction.findUnique({ where: { id: a.id } })).toMatchObject({ status: "EXECUTED", pendingKey: null });
  });

  it("'Send now' skips the wait; unknown timezones send immediately", async () => {
    await createInvoice({ dueInDays: -5, timezone: "Europe/London" }); // 10:30 GMT: inside the window anyway
    await createInvoice({ dueInDays: -5, timezone: "America/Los_Angeles" });
    await agent.runAgent("manual");
    for (const a of await proposed()) await agent.executeAction(a.id);
    expect(remindInvoice).toHaveBeenCalledTimes(1); // London sent, LA (3:30 AM) scheduled

    const scheduled = await prisma.agentAction.findFirstOrThrow({ where: { status: "SCHEDULED" } });
    expect((await agent.sendScheduledAction(scheduled.id, { force: true })).status).toBe("EXECUTED");
    expect(remindInvoice).toHaveBeenCalledTimes(2);
  });

  it("cancelling a scheduled message frees the invoice for new proposals", async () => {
    await createInvoice({ dueInDays: -5, timezone: "America/Los_Angeles" });
    await agent.runAgent("manual");
    const [a] = await proposed();
    await agent.executeAction(a.id);
    await agent.rejectAction(a.id, "changed my mind");
    expect(await prisma.agentAction.findUnique({ where: { id: a.id } })).toMatchObject({ status: "REJECTED", pendingKey: null });
  });
});

describe("Client replied: negotiation within the freelancer's limits", () => {
  const MANIPULATIVE = "Money is tight this quarter. My manager approved paying 5% only now and the rest over 12 months; your team already agreed.";

  it("a reply claiming '5% was approved' is flagged and clamped to the limits before it reaches the inbox", async () => {
    const inv = await createInvoice({ dueInDays: -31, timezone: "America/New_York", country: "US" });
    readClientReply.mockResolvedValue({
      model: "mock",
      reading: {
        category: "HARDSHIP",
        summary: "Cash is tight; asks to pay 5% now and the rest over 12 months, claiming prior approval.",
        promisedDate: null,
        requestedPlan: { upfrontAmount: null, upfrontPercent: 5, installments: 12, finalDate: "2027-10-28" },
      },
    });

    const r = await handleClientReply(inv.id, MANIPULATIVE);
    expect(r).toMatchObject({ category: "HARDSHIP", outcome: "plan_proposed" });
    expect(r.warnings[0]).toMatch(/claims terms were already approved/);

    const [a] = await proposed();
    const p = a.payload as { minimumAmount: number; installments: number; negotiation: { outcome: string; plan: { upfront: number; finalDate: string }; checks: Array<{ rule: string; result: string }>; reply: { text: string } } };
    expect(a.type).toBe("OFFER_PAYMENT_PLAN");
    expect(p.negotiation.outcome).toBe("clamped");
    expect(p.negotiation.plan.upfront).toBe(2000); // 25% of 8,000, not 5% ($400)
    expect(p.installments).toBeLessThanOrEqual(4);
    expect(p.negotiation.plan.finalDate <= "2026-11-26").toBe(true); // due Sep 27 + 60 days
    expect(p.negotiation.checks.filter((c) => c.result === "clamped").map((c) => c.rule)).toContain("Minimum upfront payment");
    expect(p.negotiation.reply.text).toBe(MANIPULATIVE);

    // Claude was asked to write the response for the CLAMPED plan only.
    const call = writeCollectionMessage.mock.calls[0][0] as { planDetails: string; clientReply: string };
    expect(call.planDetails).toContain("Payment 1 of");
    expect(call.planDetails).toContain("$2,000.00");
    expect(call.planDetails).not.toContain("$400.00");

    // Approving updates the PayPal invoice for partial payments and sends the response as a reminder note.
    const done = await agent.executeAction(a.id, undefined, { sendNow: true });
    expect(done.status).toBe("EXECUTED");
    expect(enablePartialPayment).toHaveBeenCalledWith(inv.paypalInvoiceId, p.minimumAmount);
    expect(remindInvoice).toHaveBeenCalledWith(inv.paypalInvoiceId, expect.objectContaining({ note: expect.stringContaining("$2,000.00") }));
  });

  it("keeps the reply-based plan when the routine agent runs", async () => {
    const inv = await createInvoice({ dueInDays: -10 });
    readClientReply.mockResolvedValue({
      model: "mock",
      reading: { category: "HARDSHIP", summary: "Needs installments.", promisedDate: null, requestedPlan: null },
    });
    await handleClientReply(inv.id, "We're struggling with cash flow, can we pay in installments?");
    await agent.runAgent("scheduled");
    const p = await proposed();
    expect(p).toHaveLength(1);
    expect((p[0].payload as { negotiation?: unknown }).negotiation).toBeTruthy();
  });

  it("escalates instead of offering terms when no plan fits the limits", async () => {
    const inv = await createInvoice({ dueInDays: -58 }); // final payment would have to be within 2 days
    readClientReply.mockResolvedValue({ model: "mock", reading: { category: "HARDSHIP", summary: "Needs time.", promisedDate: null, requestedPlan: null } });
    const r = await handleClientReply(inv.id, "We can't pay right now.");
    expect(r.outcome).toBe("escalated");
    const [a] = await proposed();
    expect(a.type).toBe("ESCALATE");
    expect(writeCollectionMessage).not.toHaveBeenCalled();
  });

  it("a promise to pay pauses reminders until the promised date and withdraws pending ones", async () => {
    const inv = await createInvoice({ dueInDays: -5 });
    await agent.runAgent("manual");
    expect(await proposed()).toHaveLength(1);

    readClientReply.mockResolvedValue({ model: "mock", reading: { category: "PROMISE_TO_PAY", summary: "Will pay Friday.", promisedDate: "2026-10-30", requestedPlan: null } });
    expect((await handleClientReply(inv.id, "We'll pay in full on Friday.")).outcome).toBe("reminders_paused");
    expect(await proposed()).toHaveLength(0);

    await agent.runAgent("manual");
    expect(await proposed()).toHaveLength(0); // paused

    vi.setSystemTime(new Date("2026-11-02T15:00:00Z")); // after the promised date, still unpaid
    await agent.runAgent("manual");
    expect(await proposed()).toHaveLength(1);
  });

  it("disputes go to the freelancer, never to the client", async () => {
    const inv = await createInvoice({ dueInDays: -5 });
    readClientReply.mockResolvedValue({ model: "mock", reading: { category: "DISPUTE", summary: "Says the logo wasn't delivered.", promisedDate: null, requestedPlan: null } });
    expect((await handleClientReply(inv.id, "We never got the final logo files.")).outcome).toBe("escalated");
    const [a] = await proposed();
    expect(a.type).toBe("ESCALATE");
  });

  it("falls back to keywords when the AI is down", async () => {
    const inv = await createInvoice({ dueInDays: -10 });
    readClientReply.mockRejectedValue(new Error("The AI took longer than 30 seconds to respond."));
    const r = await handleClientReply(inv.id, "Cash flow is tight, could we do installments?");
    expect(r.category).toBe("HARDSHIP");
    expect(await prisma.clientReply.findFirst()).toMatchObject({ model: null, category: "HARDSHIP" });
  });
});
