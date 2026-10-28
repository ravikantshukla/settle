/**
 * Process a verified PayPal webhook event, idempotently (keyed on the PayPal event id).
 */
import { Prisma, type PayoutStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { PayPalWebhookEvent } from "@/lib/paypal";
import { applyPayoutItem, toPayoutStatus } from "@/lib/payouts/records";
import { syncInvoiceByPayPalId } from "./syncFromPayPal";

const INVOICE_EVENTS = new Set([
  "INVOICING.INVOICE.PAID",
  "INVOICING.INVOICE.CANCELLED",
  "INVOICING.INVOICE.UPDATED",
  "INVOICING.INVOICE.REFUNDED",
]);

// PAYMENT.PAYOUTS-ITEM.<SUFFIX> -> our PayoutStatus, used when the resource lacks transaction_status.
const PAYOUT_EVENT_STATUS: Record<string, PayoutStatus> = {
  SUCCEEDED: "SUCCESS",
  FAILED: "FAILED",
  BLOCKED: "BLOCKED",
  CANCELED: "RETURNED",
  DENIED: "FAILED",
  HELD: "ONHOLD",
  REFUNDED: "REFUNDED",
  RETURNED: "RETURNED",
  UNCLAIMED: "UNCLAIMED",
};

export type WebhookOutcome = "processed" | "duplicate" | "ignored";

export async function handleWebhookEvent(event: PayPalWebhookEvent): Promise<WebhookOutcome> {
  const resourceId = typeof event.resource?.id === "string" ? event.resource.id : null;

  // Idempotency: one row per PayPal event id. Already processed -> no-op.
  const existing = await prisma.webhookEvent.findUnique({ where: { eventId: event.id } });
  if (existing?.processedAt) return "duplicate";
  if (!existing) {
    try {
      await prisma.webhookEvent.create({
        data: {
          eventId: event.id,
          eventType: event.event_type,
          resourceType: event.resource_type ?? null,
          resourceId,
          payload: event as unknown as Prisma.InputJsonValue,
          verified: true,
        },
      });
    } catch (e) {
      // A concurrent delivery of the same event won the insert.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "duplicate";
      throw e;
    }
  }

  let outcome: WebhookOutcome = "ignored";
  try {
    if (INVOICE_EVENTS.has(event.event_type)) {
      const invoiceId = invoiceIdFrom(event.resource);
      // Re-fetch from PayPal rather than trusting the payload shape; it also covers partial payments.
      if (invoiceId && (await syncInvoiceByPayPalId(invoiceId))) outcome = "processed";
    } else if (event.event_type.startsWith("PAYMENT.PAYOUTS-ITEM.")) {
      if (await applyPayoutItemEvent(event)) outcome = "processed";
    }
    await prisma.webhookEvent.update({
      where: { eventId: event.id },
      data: { processedAt: new Date(), error: null },
    });
    return outcome;
  } catch (e) {
    // Leave processedAt null so PayPal's retry gets another go.
    await prisma.webhookEvent.update({
      where: { eventId: event.id },
      data: { error: e instanceof Error ? e.message : String(e) },
    });
    throw e;
  }
}

function invoiceIdFrom(resource: Record<string, unknown>): string | null {
  const nested = resource.invoice as { id?: unknown } | undefined;
  const id = nested?.id ?? resource.id;
  return typeof id === "string" ? id : null;
}

interface PayoutItemResource {
  payout_item_id?: string;
  payout_batch_id?: string;
  transaction_status?: string;
  time_processed?: string;
  payout_item?: { sender_item_id?: string };
  errors?: { message?: string };
}

async function applyPayoutItemEvent(event: PayPalWebhookEvent): Promise<boolean> {
  const r = event.resource as PayoutItemResource;
  const suffix = event.event_type.slice("PAYMENT.PAYOUTS-ITEM.".length);
  const status = toPayoutStatus(r.transaction_status) ?? PAYOUT_EVENT_STATUS[suffix];
  if (!status) return false;
  // sender_item_id is our Payout.id; payout_item_id is PayPal's.
  return applyPayoutItem({
    payoutItemId: r.payout_item_id,
    senderItemId: r.payout_item?.sender_item_id,
    payoutBatchId: r.payout_batch_id,
    status,
    timeProcessed: r.time_processed,
    error: r.errors?.message,
  });
}
