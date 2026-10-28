/**
 * Mirror PayPal invoice state into the DB. Shared by the webhook handler and the manual sync,
 * so both paths behave identically.
 */
import { InvoiceStatus, type Invoice } from "@prisma/client";
import { agent } from "@/lib/agent";
import { num, prisma } from "@/lib/db";
import { getInvoice, PayPalError, paidAmountOf, TERMINAL_STATUSES, type PayPalInvoice } from "@/lib/paypal";

const KNOWN_STATUSES = new Set<string>(Object.values(InvoiceStatus));
const PAYMENT_STATUSES = new Set<InvoiceStatus>(["PAID", "MARKED_AS_PAID", "PARTIALLY_PAID"]);

export interface ApplyResult {
  invoiceId: string;
  changed: boolean;
  paymentReceived: boolean;
}

/** Apply a fetched PayPal invoice to its local row. Triggers the agent when the paid amount grows. */
export async function applyPayPalInvoice(local: Invoice, remote: PayPalInvoice): Promise<ApplyResult> {
  const status = KNOWN_STATUSES.has(remote.status) ? (remote.status as InvoiceStatus) : local.status;
  if (status !== remote.status) console.warn(`Unknown PayPal invoice status ${remote.status} for ${remote.id}`);

  const amountPaid = paidAmountOf(remote);
  const previousPaid = num(local.amountPaid);
  const lastPayment = remote.payments?.transactions?.at(-1)?.payment_date;
  const fullyPaid = status === "PAID" || status === "MARKED_AS_PAID";

  const data = {
    status,
    amountPaid,
    payerViewUrl: local.payerViewUrl ?? remote.detail.metadata?.recipient_view_url ?? null,
    paidAt: fullyPaid ? (local.paidAt ?? (lastPayment ? new Date(lastPayment) : new Date())) : local.paidAt,
    lastSyncedAt: new Date(),
  };
  const changed = status !== local.status || amountPaid !== previousPaid;

  // Record individual payments (idempotent on PayPal's payment_id) for the timeline and KPIs.
  for (const tx of remote.payments?.transactions ?? []) {
    if (!tx.payment_id || !tx.amount) continue;
    await prisma.invoicePayment.upsert({
      where: { paypalPaymentId: tx.payment_id },
      create: {
        invoiceId: local.id,
        paypalPaymentId: tx.payment_id,
        amount: Number(tx.amount.value),
        currency: tx.amount.currency_code,
        method: tx.method ?? null,
        paidAt: tx.payment_date ? new Date(tx.payment_date) : new Date(),
      },
      update: {},
    });
  }

  // Optimistic concurrency: only the writer that actually moves amountPaid fires the agent,
  // so a webhook and a manual sync racing on the same payment trigger it once.
  const { count } = await prisma.invoice.updateMany({
    where: { id: local.id, amountPaid: local.amountPaid },
    data,
  });

  const paymentReceived = count === 1 && amountPaid > previousPaid && PAYMENT_STATUSES.has(status);
  if (paymentReceived) {
    try {
      await agent.onPaymentReceived(local.id);
    } catch (e) {
      console.error(`agent.onPaymentReceived failed for ${local.id}`, e);
    }
  }
  return { invoiceId: local.id, changed: count === 1 && changed, paymentReceived };
}

/** Fetch one invoice from PayPal by its PayPal id and apply it. Returns null if we don't track it. */
export async function syncInvoiceByPayPalId(paypalInvoiceId: string): Promise<ApplyResult | null> {
  const local = await prisma.invoice.findUnique({ where: { paypalInvoiceId } });
  if (!local || local.isDemo) return null;
  return applyPayPalInvoice(local, await getInvoice(paypalInvoiceId));
}

export interface SyncSummary {
  checked: number;
  updated: number;
  paymentsReceived: number;
  errors: Array<{ number: string; error: string }>;
}

/** Pull the latest status of every non-terminal, non-demo invoice. Fallback for local dev without webhooks. */
export async function syncOpenInvoices(): Promise<SyncSummary> {
  const open = await prisma.invoice.findMany({
    where: {
      isDemo: false,
      paypalInvoiceId: { not: null },
      status: { notIn: TERMINAL_STATUSES as InvoiceStatus[] },
    },
  });

  const summary: SyncSummary = { checked: open.length, updated: 0, paymentsReceived: 0, errors: [] };
  for (const inv of open) {
    try {
      const r = await applyPayPalInvoice(inv, await getInvoice(inv.paypalInvoiceId!));
      if (r.changed) summary.updated++;
      if (r.paymentReceived) summary.paymentsReceived++;
    } catch (e) {
      summary.errors.push({
        number: inv.number,
        error: e instanceof PayPalError ? e.toDisplayString() : e instanceof Error ? e.message : String(e),
      });
    }
  }
  return summary;
}
