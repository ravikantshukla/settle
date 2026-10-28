import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExtractionSchema, ReviewedInvoiceSchema } from "@/lib/invoices/schema";

// --- Anthropic mocked: no network ---------------------------------------------------------------
const create = vi.fn();
vi.mock("@/lib/ai/client", () => ({
  anthropic: () => ({ beta: { messages: { create } } }),
  aiModel: () => "claude-opus-5-5",
  fallbackParams: () => ({}),
}));
const { extractInvoice } = await import("@/lib/ai/extractInvoice");

const validExtraction = {
  client: { name: "Jamie Rivera", email: "jamie@riverabakery.example", company: "Rivera Bakery LLC" },
  projectTitle: "Shopify theme + product photos",
  currency: "usd",
  lineItems: [
    { description: "Shopify theme setup", quantity: 18, unitPrice: 85 },
    { description: "Product photography", quantity: 1, unitPrice: 1200 },
  ],
  dueDate: "2026-11-12",
  paymentTerms: "Net 15",
  partialPayment: { allowed: false, minimumAmount: null },
  subcontractorSplits: [{ name: "Leo Park", email: "leo.park.photo@example.com", percentage: null, fixedAmount: 480 }],
  confidence: 0.82,
  uncertainFields: ["subcontractorSplits.0.fixedAmount"],
  notes: "Leo gets 40% of the photography line.",
};

const toolResponse = (input: unknown, extra: Record<string, unknown> = {}) => ({
  model: "claude-opus-5-5",
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id: "tu_1", name: "record_invoice_draft", input }],
  ...extra,
});

beforeEach(() => create.mockReset());

describe("ExtractionSchema", () => {
  it("accepts a complete extraction", () => {
    expect(ExtractionSchema.safeParse(validExtraction).success).toBe(true);
  });
  it("requires at least one line item", () => {
    expect(ExtractionSchema.safeParse({ ...validExtraction, lineItems: [] }).success).toBe(false);
  });
  it("rejects non-ISO due dates and out-of-range confidence", () => {
    expect(ExtractionSchema.safeParse({ ...validExtraction, dueDate: "Nov 12" }).success).toBe(false);
    expect(ExtractionSchema.safeParse({ ...validExtraction, confidence: 85 }).success).toBe(false);
  });
  it("rejects negative prices and zero quantities", () => {
    expect(ExtractionSchema.safeParse({ ...validExtraction, lineItems: [{ description: "x", quantity: 0, unitPrice: 1 }] }).success).toBe(false);
    expect(ExtractionSchema.safeParse({ ...validExtraction, lineItems: [{ description: "x", quantity: 1, unitPrice: -1 }] }).success).toBe(false);
  });
});

describe("ReviewedInvoiceSchema (what the user approves)", () => {
  const reviewed = {
    requestId: "6f1c0c1e-7a1b-4c1d-9a7e-3f4b5c6d7e8f",
    client: { name: "Jamie Rivera", email: "jamie@riverabakery.example" },
    projectTitle: "Theme",
    currency: "usd",
    lineItems: [{ description: "Build", quantity: 2, unitPrice: 500 }],
    allowPartial: true,
    minAmountDue: 200,
    splits: [{ name: "Leo", email: "leo@example.com", percentage: 20 }],
  };

  it("accepts a valid invoice and upper-cases the currency", () => {
    const r = ReviewedInvoiceSchema.parse(reviewed);
    expect(r.currency).toBe("USD");
  });
  it("requires a valid client email", () => {
    expect(ReviewedInvoiceSchema.safeParse({ ...reviewed, client: { name: "J", email: "nope" } }).success).toBe(false);
  });
  it("rejects a minimum partial payment above the total", () => {
    const r = ReviewedInvoiceSchema.safeParse({ ...reviewed, minAmountDue: 5000 });
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.path.join(".") === "minAmountDue")).toBe(true);
  });
  it("rejects subcontractor splits that exceed the invoice total", () => {
    const r = ReviewedInvoiceSchema.safeParse({ ...reviewed, splits: [{ name: "Leo", email: "leo@example.com", fixedAmount: 1500 }] });
    expect(r.success).toBe(false);
    expect(r.error?.issues.find((i) => i.path[0] === "splits")?.message).toMatch(/exceeds/);
  });
  it("requires exactly one of percentage / fixed amount per split", () => {
    expect(ReviewedInvoiceSchema.safeParse({ ...reviewed, splits: [{ name: "Leo", email: "leo@example.com" }] }).success).toBe(false);
  });
});

describe("extractInvoice (Claude mocked)", () => {
  it("returns the validated extraction from the tool call", async () => {
    create.mockResolvedValueOnce(toolResponse(validExtraction));
    const text = "Invoice jamie@riverabakery.example; Leo (leo.park.photo@example.com) gets 40% of photography.";
    const r = await extractInvoice(text, { today: "2026-10-28" });
    expect(r.currency).toBe("USD");
    expect(r.lineItems).toHaveLength(2);
    expect(r.uncertainFields).toEqual(["subcontractorSplits.0.fixedAmount"]);

    const req = create.mock.calls[0][0];
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.tools[0]).toMatchObject({ name: "record_invoice_draft", strict: true });
    expect(req.tool_choice).toMatchObject({ type: "auto" });
    expect(req.messages[0].content).toContain("Invoice date (today): 2026-10-28");
    expect(req.messages[0].content).toContain(`<agreement>\n${text}\n</agreement>`);
    expect(r.warnings).toEqual([]);
  });

  it("rejects empty input without calling the API", async () => {
    await expect(extractInvoice("   ")).rejects.toThrow(/Paste an agreement/);
    expect(create).not.toHaveBeenCalled();
  });

  it("fails clearly when the model doesn't call the tool", async () => {
    create.mockResolvedValueOnce({ model: "m", stop_reason: "end_turn", content: [{ type: "text", text: "Here you go" }] });
    await expect(extractInvoice("text")).rejects.toThrow(/did not return/);
  });

  it("fails clearly on refusals and truncation", async () => {
    create.mockResolvedValueOnce({ model: "m", stop_reason: "refusal", stop_details: { category: null }, content: [] });
    await expect(extractInvoice("text")).rejects.toThrow(/declined/);
    create.mockResolvedValueOnce({ model: "m", stop_reason: "max_tokens", content: [] });
    await expect(extractInvoice("text")).rejects.toThrow(/cut off/);
  });

  it("rejects tool output that fails zod validation", async () => {
    create.mockResolvedValueOnce(toolResponse({ ...validExtraction, lineItems: [] }));
    await expect(extractInvoice("text")).rejects.toThrow(/invalid/);
  });
});
