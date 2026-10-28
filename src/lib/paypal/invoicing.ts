/**
 * PayPal Invoicing v2 wrappers.
 * https://developer.paypal.com/docs/api/invoicing/v2/
 */
import { randomUUID } from "node:crypto";
import { paypalFetch } from "./client";
import type {
  InvoiceList,
  InvoiceStatus,
  Link,
  Money,
  PaymentMethod,
  PaymentTermType,
  PayPalInvoice,
} from "./types";

const BASE = "/v2/invoicing";

// Currencies PayPal does not allow decimals for.
const ZERO_DECIMAL = new Set(["JPY", "HUF", "TWD"]);

export function toMoney(amount: number, currency: string): Money {
  const code = currency.toUpperCase();
  return { currency_code: code, value: amount.toFixed(ZERO_DECIMAL.has(code) ? 0 : 2) };
}

/** Statuses after which PayPal will not change the invoice any further on its own. */
export const TERMINAL_STATUSES: InvoiceStatus[] = [
  "PAID",
  "MARKED_AS_PAID",
  "CANCELLED",
  "REFUNDED",
  "MARKED_AS_REFUNDED",
];

// ---------------------------------------------------------------------------

export async function generateInvoiceNumber(): Promise<string> {
  const res = await paypalFetch<{ invoice_number: string }>(
    `${BASE}/generate-next-invoice-number`,
    { method: "POST" },
  );
  return res.invoice_number;
}

export interface DraftInvoiceInput {
  recipient: {
    email: string;
    givenName?: string;
    surname?: string;
    businessName?: string;
  };
  /** Optional invoicer display info; PayPal fills the rest from the merchant account. */
  invoicer?: { businessName?: string; email?: string };
  currency: string;
  items: Array<{ name: string; description?: string; quantity: number; unitAmount: number }>;
  /** YYYY-MM-DD. Omit for "due on receipt". */
  dueDate?: string;
  termType?: PaymentTermType;
  invoiceNumber?: string;
  reference?: string;
  note?: string;
  terms?: string;
  memo?: string;
  partialPayment?: { allow: boolean; minimumAmountDue?: number };
}

export function buildInvoicePayload(input: DraftInvoiceInput) {
  const currency = input.currency.toUpperCase();
  const termType: PaymentTermType =
    input.termType ?? (input.dueDate ? "DUE_ON_DATE_SPECIFIED" : "DUE_ON_RECEIPT");

  return {
    detail: {
      invoice_number: input.invoiceNumber,
      reference: input.reference,
      currency_code: currency,
      note: input.note,
      terms_and_conditions: input.terms,
      memo: input.memo,
      payment_term: {
        term_type: termType,
        due_date: termType === "DUE_ON_DATE_SPECIFIED" ? input.dueDate : undefined,
      },
    },
    invoicer:
      input.invoicer && (input.invoicer.businessName || input.invoicer.email)
        ? { business_name: input.invoicer.businessName, email_address: input.invoicer.email }
        : undefined,
    primary_recipients: [
      {
        billing_info: {
          email_address: input.recipient.email,
          business_name: input.recipient.businessName,
          name:
            input.recipient.givenName || input.recipient.surname
              ? { given_name: input.recipient.givenName, surname: input.recipient.surname }
              : undefined,
        },
      },
    ],
    items: input.items.map((it) => ({
      name: it.name.slice(0, 200),
      description: it.description?.slice(0, 1000),
      quantity: String(it.quantity),
      unit_amount: toMoney(it.unitAmount, currency),
      unit_of_measure: "QUANTITY" as const,
    })),
    configuration: {
      allow_tip: false,
      tax_inclusive: false,
      partial_payment: input.partialPayment?.allow
        ? {
            allow_partial_payment: true,
            minimum_amount_due:
              input.partialPayment.minimumAmountDue !== undefined
                ? toMoney(input.partialPayment.minimumAmountDue, currency)
                : undefined,
          }
        : { allow_partial_payment: false },
    },
  };
}

/** Create a DRAFT invoice. Returns the full invoice resource. */
export async function createDraftInvoice(
  input: DraftInvoiceInput,
  opts: { requestId?: string } = {},
): Promise<PayPalInvoice> {
  const payload = buildInvoicePayload({
    ...input,
    invoiceNumber: input.invoiceNumber ?? (await generateInvoiceNumber()),
  });
  return paypalFetch<PayPalInvoice>(`${BASE}/invoices`, {
    method: "POST",
    body: payload,
    preferRepresentation: true,
    requestId: opts.requestId ?? randomUUID(),
  });
}

export interface SendInvoiceResult {
  /** Link the client uses to view and pay the invoice. */
  payerViewUrl?: string;
  links: Link[];
}

/** Send a DRAFT invoice to its recipient. */
export async function sendInvoice(
  invoiceId: string,
  opts: { subject?: string; note?: string; sendToInvoicer?: boolean; requestId?: string } = {},
): Promise<SendInvoiceResult> {
  const res = await paypalFetch<{ href?: string; rel?: string; links?: Link[] } | undefined>(
    `${BASE}/invoices/${encodeURIComponent(invoiceId)}/send`,
    {
      method: "POST",
      body: {
        subject: opts.subject,
        note: opts.note,
        send_to_recipient: true,
        send_to_invoicer: opts.sendToInvoicer ?? false,
      },
      requestId: opts.requestId ?? randomUUID(),
    },
  );

  // PayPal returns either { links: [...] } or a single link object.
  const links: Link[] = res?.links ?? (res?.href ? [{ href: res.href, rel: res.rel ?? "" }] : []);
  let payerViewUrl = links.find((l) => l.rel === "payer-view")?.href;
  if (!payerViewUrl) {
    payerViewUrl = (await getInvoice(invoiceId)).detail.metadata?.recipient_view_url;
  }
  return { payerViewUrl, links };
}

export async function getInvoice(invoiceId: string): Promise<PayPalInvoice> {
  return paypalFetch<PayPalInvoice>(`${BASE}/invoices/${encodeURIComponent(invoiceId)}`);
}

export async function listInvoices(
  opts: { page?: number; pageSize?: number } = {},
): Promise<InvoiceList> {
  return paypalFetch<InvoiceList>(`${BASE}/invoices`, {
    query: {
      page: opts.page ?? 1,
      page_size: opts.pageSize ?? 20,
      total_required: true,
    },
  });
}

/** Send a payment reminder for a SENT / UNPAID / PARTIALLY_PAID invoice. */
export async function remindInvoice(
  invoiceId: string,
  opts: { subject?: string; note: string; sendToInvoicer?: boolean; additionalRecipients?: string[] },
): Promise<void> {
  await paypalFetch<void>(`${BASE}/invoices/${encodeURIComponent(invoiceId)}/remind`, {
    method: "POST",
    body: {
      subject: opts.subject,
      note: opts.note,
      send_to_invoicer: opts.sendToInvoicer ?? false,
      additional_recipients: opts.additionalRecipients,
    },
  });
}

export async function cancelInvoice(
  invoiceId: string,
  opts: { subject?: string; note?: string; notifyRecipient?: boolean } = {},
): Promise<void> {
  await paypalFetch<void>(`${BASE}/invoices/${encodeURIComponent(invoiceId)}/cancel`, {
    method: "POST",
    body: {
      subject: opts.subject,
      note: opts.note,
      send_to_recipient: opts.notifyRecipient ?? true,
      send_to_invoicer: false,
    },
  });
}

/** Record an external (off-PayPal) payment against an invoice, e.g. a bank transfer. */
export async function recordPayment(
  invoiceId: string,
  input: { amount: number; currency: string; method: PaymentMethod; paymentDate?: string; note?: string },
): Promise<{ paymentId: string }> {
  const res = await paypalFetch<{ payment_id: string }>(
    `${BASE}/invoices/${encodeURIComponent(invoiceId)}/payments`,
    {
      method: "POST",
      body: {
        method: input.method,
        payment_date: input.paymentDate ?? new Date().toISOString().slice(0, 10),
        amount: toMoney(input.amount, input.currency),
        note: input.note,
      },
    },
  );
  return { paymentId: res.payment_id };
}

/** Amount paid so far, as a number (0 when nothing has been paid). */
export function paidAmountOf(invoice: PayPalInvoice): number {
  return Number(invoice.payments?.paid_amount?.value ?? 0);
}
