/**
 * Agent end to end against a real (temporary) SQLite database. Claude is mocked; PayPal is not
 * involved (runAgent only proposes). Covers the demo-clock flow and duplicate prevention.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "settle-test-"));
process.env.DATABASE_URL = `file:${join(dir, "test.db").replace(/\\/g, "/")}`;

const writeCollectionMessage = vi.fn();
vi.mock("@/lib/ai/collectionDecision", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/collectionDecision")>()),
  writeCollectionMessage: (...args: unknown[]) => writeCollectionMessage(...args),
}));
vi.mock("@/lib/ai/riskScore", () => ({
  writeRiskReasons: vi.fn(async () => {
    throw new Error("AI down");
  }),
}));

type Db = typeof import("@/lib/db");
let prisma: Db["prisma"];
let clock: typeof import("@/lib/clock").clock;
let runAgent: typeof import("@/lib/agent/runAgent").runAgent;

beforeAll(async () => {
  execSync("npx prisma migrate deploy", { env: { ...process.env }, stdio: "ignore" });
  ({ prisma } = await import("@/lib/db"));
  ({ clock } = await import("@/lib/clock"));
  ({ runAgent } = await import("@/lib/agent/runAgent"));
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await prisma.agentRunLog.deleteMany();
  await prisma.agentAction.deleteMany();
  await prisma.invoiceRisk.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.project.deleteMany();
  await prisma.client.deleteMany();
  await clock.reset();
  writeCollectionMessage.mockReset().mockImplementation(async (input: { action: string; tone: string }) => ({
    model: "mock",
    draft: {
      subject: input.action === "ESCALATE" ? null : `${input.tone} subject`,
      message: `${input.tone} ${input.action} message`,
      reasoning: `${input.tone} because rules said ${input.action}`,
    },
  }));
});

async function createInvoice(dueInDays: number, notes: string | null = null) {
  const now = await clock.now();
  const client = await prisma.client.create({ data: { name: "Jamie Rivera", email: "jamie@example.com", company: "Rivera Bakery", notes } });
  const project = await prisma.project.create({ data: { clientId: client.id, title: "Theme" } });
  return prisma.invoice.create({
    data: {
      projectId: project.id,
      number: `INV-${Math.random().toString(36).slice(2, 8)}`,
      paypalInvoiceId: `INV2-${Math.random().toString(36).slice(2, 8)}`,
      status: "SENT",
      amount: 2730,
      issueDate: now,
      sentAt: now,
      dueDate: new Date(now.getTime() + dueInDays * 86_400_000),
    },
  });
}

const pending = () => prisma.agentAction.findMany({ where: { status: "PROPOSED" } });

describe("demo clock flow", () => {
  it("+7 days -> firm reminder; +30 more -> payment plan (replacing the stale reminder)", async () => {
    await createInvoice(5);

    expect((await runAgent("manual")).proposed).toBe(0); // not due yet

    await clock.advanceDays(7);
    await runAgent("manual");
    let p = await pending();
    expect(p).toHaveLength(1);
    expect(p[0].type).toBe("SEND_REMINDER");
    expect(p[0].payload).toMatchObject({ tone: "firm", stage: "OVERDUE", subject: "firm subject" });
    expect(writeCollectionMessage).toHaveBeenCalledWith(expect.objectContaining({ action: "SEND_REMINDER", tone: "firm" }));

    await clock.advanceDays(30);
    await runAgent("manual");
    p = await pending();
    expect(p).toHaveLength(1);
    expect(p[0].type).toBe("OFFER_PAYMENT_PLAN");
    expect(p[0].payload).toMatchObject({ tone: "empathetic", minimumAmount: 950 }); // ~1/3 of 2730, rounded up to 50
    const superseded = await prisma.agentAction.findFirst({ where: { type: "SEND_REMINDER" } });
    expect(superseded).toMatchObject({ status: "REJECTED", result: expect.objectContaining({ superseded: true }) });
  });

  it("uses the demo clock for proposal timestamps", async () => {
    await createInvoice(1);
    const simulated = await clock.advanceDays(10);
    await runAgent("manual");
    const [a] = await pending();
    expect(Math.abs(a.proposedAt.getTime() - simulated.getTime())).toBeLessThan(60_000);
  });
});

describe("no duplicate proposals", () => {
  it("running the agent twice creates one proposal", async () => {
    await createInvoice(2);
    await clock.advanceDays(5);
    await runAgent("manual");
    const second = await runAgent("manual");
    expect(second.proposed).toBe(0);
    expect(await pending()).toHaveLength(1);
  });

  it("two concurrent runs still create one proposal", async () => {
    await createInvoice(2);
    await clock.advanceDays(5);
    await Promise.all([runAgent("manual"), runAgent("manual"), runAgent("manual")]);
    expect(await pending()).toHaveLength(1);
  });
});

describe("AI fallback", () => {
  it("uses a template message when the AI fails or times out", async () => {
    writeCollectionMessage.mockRejectedValue(new Error("The AI took longer than 30 seconds to respond."));
    await createInvoice(2);
    await clock.advanceDays(9);
    const r = await runAgent("manual");
    expect(r.errors).toBe(0);
    const [a] = await pending();
    expect(a.type).toBe("SEND_REMINDER");
    expect(a.payload).toMatchObject({ subject: expect.stringContaining("overdue"), message: expect.stringContaining("7 days overdue") });
    expect(a.reasoning).toMatch(/template used/);
  });

  it("falls back to rule-based risk reasons when the AI is down", async () => {
    await createInvoice(-3);
    await runAgent("manual");
    const risk = await prisma.invoiceRisk.findFirst();
    expect(risk?.reason).toMatch(/days overdue/i);
    expect(risk?.model).toBeNull();
  });
});
