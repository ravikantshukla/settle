/**
 * PayPal Payouts v1 wrappers.
 * https://developer.paypal.com/docs/api/payments.payouts-batch/v1/
 */
import { paypalFetch } from "./client";
import { toMoney } from "./invoicing";
import type { Money } from "./types";

export type PayoutBatchStatus = "DENIED" | "PENDING" | "PROCESSING" | "SUCCESS" | "CANCELED";

export interface PayoutItem {
  payout_item_id: string;
  transaction_id?: string;
  transaction_status?: string;
  payout_batch_id: string;
  time_processed?: string;
  payout_item: {
    recipient_type?: string;
    amount: Money;
    note?: string;
    receiver: string;
    sender_item_id?: string;
  };
  errors?: { name?: string; message?: string };
}

export interface PayoutBatch {
  batch_header: {
    payout_batch_id: string;
    batch_status: PayoutBatchStatus;
    sender_batch_header?: { sender_batch_id?: string; email_subject?: string };
    time_created?: string;
    time_completed?: string;
    amount?: Money;
    fees?: Money;
  };
  items?: PayoutItem[];
}

export interface PayoutRecipient {
  email: string;
  amount: number;
  currency: string;
  note?: string;
  /** Our reference, echoed back in webhooks; we use the PayoutSplit id. */
  senderItemId: string;
}

/**
 * Create a payout batch. `senderBatchId` makes the call idempotent: PayPal rejects a second
 * batch with the same id (for ~30 days), so a retried approval can't pay twice.
 */
export async function createPayoutBatch(input: {
  senderBatchId: string;
  emailSubject?: string;
  emailMessage?: string;
  items: PayoutRecipient[];
}): Promise<PayoutBatch> {
  return paypalFetch<PayoutBatch>("/v1/payments/payouts", {
    method: "POST",
    body: {
      sender_batch_header: {
        sender_batch_id: input.senderBatchId,
        email_subject: input.emailSubject ?? "You have a payout",
        email_message: input.emailMessage,
      },
      items: input.items.map((it) => ({
        recipient_type: "EMAIL",
        receiver: it.email,
        amount: toMoney(it.amount, it.currency),
        note: it.note,
        sender_item_id: it.senderItemId,
      })),
    },
  });
}

export async function getPayoutBatch(payoutBatchId: string): Promise<PayoutBatch> {
  return paypalFetch<PayoutBatch>(`/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}`, {
    query: { fields: "batch_header,items", page_size: 100 },
  });
}

export async function getPayoutItem(payoutItemId: string): Promise<PayoutItem> {
  return paypalFetch<PayoutItem>(`/v1/payments/payouts-item/${encodeURIComponent(payoutItemId)}`);
}
