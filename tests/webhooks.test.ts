import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- In-memory stand-in for the WebhookEvent table --------------------------------------------
type Row = { eventId: string; processedAt: Date | null; error: string | null; payload: unknown };
const store = new Map<string, Row>();
const p2002 = () => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });

vi.mock("@/lib/db", () => ({
  prisma: {
    appSetting: { findUnique: vi.fn(async () => null) }, // demo clock offset
    webhookEvent: {
      findUnique: vi.fn(async ({ where }: { where: { eventId: string } }) => store.get(where.eventId) ?? null),
      create: vi.fn(async ({ data }: { data: Row }) => {
        if (store.has(data.eventId)) throw p2002();
        const row = { ...data, processedAt: null, error: null };
        store.set(data.eventId, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { eventId: string }; data: Partial<Row> }) => {
        const row = { ...store.get(where.eventId)!, ...data };
        store.set(where.eventId, row);
        return row;
      }),
    },
  },
}));

const syncInvoiceByPayPalId = vi.fn();
vi.mock("@/lib/invoices/syncFromPayPal", () => ({ syncInvoiceByPayPalId: (id: string) => syncInvoiceByPayPalId(id) }));

const applyPayoutItem = vi.fn();
vi.mock("@/lib/payouts/records", () => ({
  applyPayoutItem: (u: unknown) => applyPayoutItem(u),
  toPayoutStatus: (s: string | undefined) => (s && ["SUCCESS", "FAILED", "PENDING", "UNCLAIMED"].includes(s) ? s : null),
}));

const { handleWebhookEvent } = await import("@/lib/invoices/handleWebhookEvent");

const paidEvent = (id = "WH-1") => ({
  id,
  event_type: "INVOICING.INVOICE.PAID",
  resource_type: "invoices",
  resource: { id: "INV2-AAAA-BBBB" },
});

beforeEach(() => {
  store.clear();
  syncInvoiceByPayPalId.mockReset().mockResolvedValue({ invoiceId: "inv_1", changed: true, paymentReceived: true });
  applyPayoutItem.mockReset().mockResolvedValue(true);
});

describe("handleWebhookEvent idempotency", () => {
  it("processes an event once and treats redeliveries as duplicates", async () => {
    expect(await handleWebhookEvent(paidEvent())).toBe("processed");
    expect(await handleWebhookEvent(paidEvent())).toBe("duplicate");
    expect(await handleWebhookEvent(paidEvent())).toBe("duplicate");
    expect(syncInvoiceByPayPalId).toHaveBeenCalledTimes(1);
    expect(syncInvoiceByPayPalId).toHaveBeenCalledWith("INV2-AAAA-BBBB");
    expect(store.get("WH-1")?.processedAt).toBeInstanceOf(Date);
  });

  it("treats a concurrent delivery that loses the insert race as a duplicate", async () => {
    store.set("WH-2", { eventId: "WH-2", processedAt: null, error: null, payload: {} });
    const { prisma } = await import("@/lib/db");
    // Simulate: findUnique saw nothing, but another request inserted before our create.
    vi.mocked(prisma.webhookEvent.findUnique).mockResolvedValueOnce(null);
    expect(await handleWebhookEvent(paidEvent("WH-2"))).toBe("duplicate");
    expect(syncInvoiceByPayPalId).not.toHaveBeenCalled();
  });

  it("leaves a failed event unprocessed so PayPal's retry is handled", async () => {
    syncInvoiceByPayPalId.mockRejectedValueOnce(new Error("PayPal 503"));
    await expect(handleWebhookEvent(paidEvent("WH-3"))).rejects.toThrow("PayPal 503");
    expect(store.get("WH-3")).toMatchObject({ processedAt: null, error: "PayPal 503" });

    expect(await handleWebhookEvent(paidEvent("WH-3"))).toBe("processed");
    expect(store.get("WH-3")?.processedAt).toBeInstanceOf(Date);
    expect(syncInvoiceByPayPalId).toHaveBeenCalledTimes(2);
  });

  it("reads the invoice id from a nested resource.invoice too", async () => {
    await handleWebhookEvent({ ...paidEvent("WH-4"), resource: { invoice: { id: "INV2-NESTED" } } });
    expect(syncInvoiceByPayPalId).toHaveBeenCalledWith("INV2-NESTED");
  });

  it("marks events for invoices we don't track as ignored (but still stored)", async () => {
    syncInvoiceByPayPalId.mockResolvedValueOnce(null);
    expect(await handleWebhookEvent(paidEvent("WH-5"))).toBe("ignored");
    expect(store.get("WH-5")?.processedAt).toBeInstanceOf(Date);
  });

  it("maps payout item events to payout updates", async () => {
    const outcome = await handleWebhookEvent({
      id: "WH-6",
      event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
      resource: { payout_item_id: "ITEM-1", payout_batch_id: "BATCH-1", transaction_status: "SUCCESS", payout_item: { sender_item_id: "payout_1" } },
    });
    expect(outcome).toBe("processed");
    expect(applyPayoutItem).toHaveBeenCalledWith(
      expect.objectContaining({ payoutItemId: "ITEM-1", senderItemId: "payout_1", payoutBatchId: "BATCH-1", status: "SUCCESS" }),
    );
  });

  it("falls back to the event type when the payout status is missing", async () => {
    await handleWebhookEvent({ id: "WH-7", event_type: "PAYMENT.PAYOUTS-ITEM.UNCLAIMED", resource: { payout_item_id: "ITEM-2" } });
    expect(applyPayoutItem).toHaveBeenCalledWith(expect.objectContaining({ status: "UNCLAIMED" }));
  });
});

describe("webhook signature verification (PayPal mocked via fetch)", () => {
  const headers = {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/cert.pem",
    "paypal-transmission-id": "t-1",
    "paypal-transmission-sig": "sig",
    "paypal-transmission-time": "2026-11-01T00:00:00Z",
  };

  function mockPayPal(verification: "SUCCESS" | "FAILURE") {
    const calls: Array<{ url: string; body: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const u = String(url);
        calls.push({ url: u, body: String(init?.body ?? "") });
        if (u.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
        return new Response(JSON.stringify({ verification_status: verification }));
      }),
    );
    return calls;
  }

  it("rejects unverified deliveries without storing them", async () => {
    mockPayPal("FAILURE");
    const { POST } = await import("@/app/api/webhooks/paypal/route");
    const res = await POST(new Request("http://x/api/webhooks/paypal", { method: "POST", headers, body: JSON.stringify(paidEvent("WH-8")) }));
    expect(res.status).toBe(401);
    expect(store.has("WH-8")).toBe(false);
  });

  it("verifies with the exact raw body and processes verified events", async () => {
    const calls = mockPayPal("SUCCESS");
    const { POST } = await import("@/app/api/webhooks/paypal/route");
    // Unusual spacing must survive byte-for-byte into the verification request.
    const raw = `{"id":"WH-9",  "event_type":"INVOICING.INVOICE.PAID","resource":{"id":"INV2-RAW"}}`;
    const res = await POST(new Request("http://x/api/webhooks/paypal", { method: "POST", headers, body: raw }));
    expect(res.status).toBe(200);
    const verify = calls.find((c) => c.url.includes("verify-webhook-signature"))!;
    expect(verify.body).toContain(`"webhook_event":${raw}`);
    expect(verify.body).toContain(`"webhook_id":"WH-TEST"`);
    expect(syncInvoiceByPayPalId).toHaveBeenCalledWith("INV2-RAW");
  });

  it("rejects deliveries missing PayPal signature headers", async () => {
    mockPayPal("SUCCESS");
    const { POST } = await import("@/app/api/webhooks/paypal/route");
    const res = await POST(new Request("http://x/api/webhooks/paypal", { method: "POST", body: JSON.stringify(paidEvent("WH-10")) }));
    expect(res.status).toBe(401);
  });
});
