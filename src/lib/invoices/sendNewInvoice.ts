/**
 * "Approve & send via PayPal": persist Client/Project/Invoice, create + send the PayPal invoice,
 * and record an EXECUTED SEND_INVOICE AgentAction (the user's click is the approval).
 */
import { clock } from "@/lib/clock";
import { prisma } from "@/lib/db";
import { DemoConfigError, invoiceRecipient } from "@/lib/demo/routing";
import { createDraftInvoice, PayPalError, sendInvoice } from "@/lib/paypal";
import { invoiceTotal, type ReviewedInvoice } from "./schema";

export interface SendNewInvoiceResult {
  invoiceId: string;
  paypalInvoiceId: string;
  number: string;
  payerViewUrl: string | null;
  status: string;
  /** Where PayPal sent it, and whether DEMO_MODE re-routed it from the extracted email. */
  recipientEmail: string;
  routed: boolean;
}

export class SendInvoiceError extends Error {
  constructor(
    message: string,
    public readonly stage: "config" | "paypal_draft" | "paypal_send",
    public readonly invoiceId?: string,
  ) {
    super(message);
    this.name = "SendInvoiceError";
  }
}

function splitName(full: string): { givenName?: string; surname?: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return { givenName: parts[0] };
  return { givenName: parts.slice(0, -1).join(" "), surname: parts.at(-1) };
}

const errorMessage = (e: unknown) =>
  e instanceof PayPalError ? e.toDisplayString() : e instanceof Error ? e.message : String(e);

export interface SendOptions {
  /** Seed only: send to this address regardless of DEMO_MODE. */
  forceRecipient?: string;
  /** Seed only: tag created rows as sample data (badge in the UI). */
  isDemo?: boolean;
  clientNotes?: string;
}

export async function sendNewInvoice(input: ReviewedInvoice, opts: SendOptions = {}): Promise<SendNewInvoiceResult> {
  const amount = invoiceTotal(input.lineItems);
  const minAmountDue = input.allowPartial ? input.minAmountDue : undefined;
  const today = await clock.now();

  let recipient: { email: string; routed: boolean };
  try {
    recipient = opts.forceRecipient
      ? { email: opts.forceRecipient, routed: opts.forceRecipient.toLowerCase() !== input.client.email.toLowerCase() }
      : invoiceRecipient(input.client.email);
  } catch (e) {
    if (e instanceof DemoConfigError) throw new SendInvoiceError(e.message, "config");
    throw e;
  }

  // 1. PayPal draft first, so a PayPal validation error leaves no orphan rows behind.
  let draft;
  try {
    draft = await createDraftInvoice(
      {
        recipient: {
          email: recipient.email,
          businessName: input.client.company || undefined,
          ...splitName(input.client.name),
        },
        currency: input.currency,
        dueDate: input.dueDate,
        terms: input.paymentTerms,
        note: input.note,
        reference: input.projectTitle.slice(0, 120),
        items: input.lineItems.map((li) => ({
          name: li.description,
          quantity: li.quantity,
          unitAmount: li.unitPrice,
        })),
        partialPayment: { allow: input.allowPartial, minimumAmountDue: minAmountDue },
      },
      { requestId: `${input.requestId}-draft` },
    );
  } catch (e) {
    throw new SendInvoiceError(errorMessage(e), "paypal_draft");
  }

  // 2. Persist everything locally.
  const invoice = await prisma.$transaction(async (tx) => {
    const existingClient = await tx.client.findFirst({
      where: { email: input.client.email, isDemo: opts.isDemo ?? false },
    });
    const location = {
      ...(input.client.timezone && { timezone: input.client.timezone }),
      ...(input.client.country && { country: input.client.country }),
    };
    const client = existingClient
      ? Object.keys(location).length
        ? await tx.client.update({ where: { id: existingClient.id }, data: location })
        : existingClient
      : await tx.client.create({
          data: {
            name: input.client.name,
            email: input.client.email,
            company: input.client.company || null,
            notes: opts.clientNotes ?? null,
            ...location,
            isDemo: opts.isDemo ?? false,
          },
        });

    const project = await tx.project.create({
      data: { clientId: client.id, title: input.projectTitle, sourceText: input.sourceText, isDemo: opts.isDemo ?? false },
    });

    const splits = [];
    for (const s of input.splits) {
      const sub =
        (await tx.subcontractor.findFirst({ where: { paypalEmail: s.email, isDemo: opts.isDemo ?? false } })) ??
        (await tx.subcontractor.create({ data: { name: s.name, paypalEmail: s.email, isDemo: opts.isDemo ?? false } }));
      splits.push({ subcontractorId: sub.id, percentage: s.percentage, fixedAmount: s.fixedAmount });
    }

    return tx.invoice.create({
      data: {
        projectId: project.id,
        paypalInvoiceId: draft.id,
        number: draft.detail.invoice_number ?? draft.id,
        status: "DRAFT",
        currency: input.currency,
        amount,
        issueDate: today,
        recipientEmail: recipient.email,
        isDemo: opts.isDemo ?? false,
        dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : null,
        paymentTerms: input.paymentTerms,
        note: input.note,
        allowPartial: input.allowPartial,
        minAmountDue,
        lineItems: {
          create: input.lineItems.map((li, position) => ({
            position,
            description: li.description,
            qty: li.quantity,
            unitAmount: li.unitPrice,
          })),
        },
        payoutSplits: { create: splits },
      },
    });
  });

  const payload = {
    paypalInvoiceId: draft.id,
    number: invoice.number,
    recipient: recipient.email,
    ...(recipient.routed && { extractedRecipient: input.client.email, routedToSandboxBuyer: true }),
    amount,
    currency: input.currency,
  };

  // 3. Send it.
  try {
    const sent = await sendInvoice(draft.id, { requestId: `${input.requestId}-send` });
    const now = await clock.now();
    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: "SENT", sentAt: now, payerViewUrl: sent.payerViewUrl ?? null, lastSyncedAt: now },
    });
    await prisma.agentAction.create({
      data: {
        type: "SEND_INVOICE",
        status: "EXECUTED",
        invoiceId: invoice.id,
        payload,
        reasoning: "Reviewed and approved by the user from the new-invoice form.",
        result: { payerViewUrl: sent.payerViewUrl ?? null, links: sent.links.map((l) => ({ ...l })) },
        decidedAt: now,
        executedAt: now,
      },
    });
    return {
      invoiceId: updated.id,
      paypalInvoiceId: draft.id,
      number: updated.number,
      payerViewUrl: updated.payerViewUrl,
      status: updated.status,
      recipientEmail: recipient.email,
      routed: recipient.routed,
    };
  } catch (e) {
    const message = errorMessage(e);
    await prisma.agentAction.create({
      data: {
        type: "SEND_INVOICE",
        status: "FAILED",
        invoiceId: invoice.id,
        payload,
        reasoning: "Reviewed and approved by the user from the new-invoice form.",
        result: { error: message },
        decidedAt: await clock.now(),
      },
    });
    throw new SendInvoiceError(message, "paypal_send", invoice.id);
  }
}
