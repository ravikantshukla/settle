/** Subset of PayPal Invoicing v2 types that Settle uses. */

export interface Money {
  currency_code: string;
  value: string;
}

export type InvoiceStatus =
  | "DRAFT"
  | "SENT"
  | "SCHEDULED"
  | "PAID"
  | "MARKED_AS_PAID"
  | "CANCELLED"
  | "REFUNDED"
  | "PARTIALLY_PAID"
  | "PARTIALLY_REFUNDED"
  | "MARKED_AS_REFUNDED"
  | "UNPAID"
  | "PAYMENT_PENDING";

export type PaymentTermType =
  | "DUE_ON_RECEIPT"
  | "DUE_ON_DATE_SPECIFIED"
  | "NET_10"
  | "NET_15"
  | "NET_30"
  | "NET_45"
  | "NET_60"
  | "NET_90"
  | "NO_DUE_DATE";

export type PaymentMethod =
  | "BANK_TRANSFER"
  | "CASH"
  | "CHECK"
  | "CREDIT_CARD"
  | "DEBIT_CARD"
  | "PAYPAL"
  | "WIRE_TRANSFER"
  | "OTHER";

export interface Name {
  given_name?: string;
  surname?: string;
  full_name?: string;
}

export interface InvoiceItem {
  name: string;
  description?: string;
  quantity: string;
  unit_amount: Money;
  unit_of_measure?: "QUANTITY" | "HOURS" | "AMOUNT";
}

export interface PayPalInvoice {
  id: string;
  status: InvoiceStatus;
  detail: {
    invoice_number?: string;
    reference?: string;
    currency_code: string;
    invoice_date?: string;
    note?: string;
    terms_and_conditions?: string;
    memo?: string;
    payment_term?: { term_type?: PaymentTermType; due_date?: string };
    metadata?: {
      create_time?: string;
      last_update_time?: string;
      recipient_view_url?: string;
      invoicer_view_url?: string;
    };
  };
  invoicer?: { name?: Name; email_address?: string; business_name?: string };
  primary_recipients?: Array<{
    billing_info: { name?: Name; email_address?: string; business_name?: string };
  }>;
  items?: InvoiceItem[];
  configuration?: {
    allow_tip?: boolean;
    tax_inclusive?: boolean;
    partial_payment?: { allow_partial_payment: boolean; minimum_amount_due?: Money };
  };
  amount?: Money & { breakdown?: Record<string, unknown> };
  due_amount?: Money;
  payments?: {
    paid_amount?: Money;
    transactions?: Array<{
      payment_id?: string;
      method?: PaymentMethod;
      payment_date?: string;
      amount?: Money;
      type?: string;
    }>;
  };
  links?: Link[];
}

export interface Link {
  href: string;
  rel: string;
  method?: string;
}

export interface InvoiceList {
  items?: PayPalInvoice[];
  total_items?: number;
  total_pages?: number;
  links?: Link[];
}
