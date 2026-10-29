/** Load invoices with everything the agent needs, and derive policy facts + Claude context. */
import type { Prisma } from "@prisma/client";
import { num, prisma } from "@/lib/db";
import { COLLECTION_ACTIONS, daysOverdue, DAY_MS, hasHardshipSignal, type InvoiceFacts, type Stage } from "./policy";

export const agentInvoiceInclude = {
  project: { include: { client: true } },
  agentActions: { orderBy: { createdAt: "asc" } },
  payoutSplits: { include: { subcontractor: true, payouts: true } },
  payments: { orderBy: { paidAt: "asc" } },
  clientReplies: { orderBy: { receivedAt: "asc" } },
} satisfies Prisma.InvoiceInclude;

export type AgentInvoice = Prisma.InvoiceGetPayload<{ include: typeof agentInvoiceInclude }>;

export const collectKey = (invoiceId: string) => `collect:${invoiceId}`;
export const payoutKey = (invoiceId: string) => `payout:${invoiceId}`;

const CONTACT_TYPES = new Set(["SEND_REMINDER", "OFFER_PAYMENT_PLAN"]);

export function contactHistory(inv: AgentInvoice) {
  return inv.agentActions
    .filter((a) => CONTACT_TYPES.has(a.type) && a.status === "EXECUTED")
    .map((a) => ({
      type: a.type,
      at: a.executedAt ?? a.updatedAt,
      subject: (a.payload as { subject?: string } | null)?.subject ?? null,
    }));
}

export function factsFor(inv: AgentInvoice): InvoiceFacts {
  const contacts = contactHistory(inv);
  const collection = inv.agentActions.filter((a) => COLLECTION_ACTIONS.includes(a.type));
  const rejected = collection.filter((a) => a.status === "REJECTED" && a.decidedAt).map((a) => a.decidedAt!);
  return {
    status: inv.status,
    dueDate: inv.dueDate,
    amount: num(inv.amount),
    amountPaid: num(inv.amountPaid),
    allowPartial: inv.allowPartial,
    lastContactAt: contacts.at(-1)?.at ?? null,
    reminderCount: contacts.filter((c) => c.type === "SEND_REMINDER").length,
    planOffered: contacts.some((c) => c.type === "OFFER_PAYMENT_PLAN"),
    pendingAction: (() => {
      const pending = collection.find((a) => a.status === "PROPOSED" || a.status === "APPROVED" || a.status === "SCHEDULED");
      if (!pending) return null;
      const p = pending.payload as { stage?: Stage; negotiation?: unknown; reply?: unknown } | null;
      return { type: pending.type, stage: (p?.stage ?? null) as Stage | null, fromReply: !!(p?.negotiation || p?.reply) };
    })(),
    lastRejectedAt: rejected.length ? new Date(Math.max(...rejected.map((d) => d.getTime()))) : null,
    hardshipSignal: hasHardshipSignal(inv.project.client.notes),
    promisedBy: inv.clientReplies.filter((r) => r.category === "PROMISE_TO_PAY" && r.promisedDate).at(-1)?.promisedDate ?? null,
  };
}

export interface ClientHistory {
  paidInvoices: number;
  averageDaysLate: number | null;
  paidOnTime: number;
  otherOpenInvoices: number;
  otherOutstanding: number;
}

/** Payment history per client, computed from all their invoices. */
export async function clientHistories(clientIds: string[]): Promise<Map<string, (excludeInvoiceId: string) => ClientHistory>> {
  const all = await prisma.invoice.findMany({
    where: { project: { clientId: { in: clientIds } } },
    select: { id: true, status: true, dueDate: true, paidAt: true, amount: true, amountPaid: true, project: { select: { clientId: true } } },
  });
  const byClient = new Map<string, typeof all>();
  for (const inv of all) {
    const list = byClient.get(inv.project.clientId) ?? [];
    list.push(inv);
    byClient.set(inv.project.clientId, list);
  }

  const result = new Map<string, (excludeInvoiceId: string) => ClientHistory>();
  for (const [clientId, invoices] of byClient) {
    result.set(clientId, (exclude) => {
      const others = invoices.filter((i) => i.id !== exclude);
      const paid = others.filter((i) => i.paidAt && i.dueDate && (i.status === "PAID" || i.status === "MARKED_AS_PAID"));
      const late = paid.map((i) => (i.paidAt!.getTime() - i.dueDate!.getTime()) / DAY_MS);
      const open = others.filter((i) => ["SENT", "UNPAID", "PARTIALLY_PAID", "PAYMENT_PENDING"].includes(i.status));
      return {
        paidInvoices: paid.length,
        averageDaysLate: late.length ? Math.round(late.reduce((a, b) => a + b, 0) / late.length) : null,
        paidOnTime: late.filter((d) => d <= 0).length,
        otherOpenInvoices: open.length,
        otherOutstanding: Math.round(open.reduce((s, i) => s + num(i.amount) - num(i.amountPaid), 0) * 100) / 100,
      };
    });
  }
  return result;
}

/** The facts Claude sees for one invoice. */
export function claudeFacts(
  inv: AgentInvoice,
  history: ClientHistory | undefined,
  now: Date,
  freelancer?: { name: string; city: string },
) {
  const client = inv.project.client;
  return {
    invoice: {
      number: inv.number,
      project: inv.project.title,
      currency: inv.currency,
      amount: num(inv.amount),
      amountPaid: num(inv.amountPaid),
      outstanding: Math.round((num(inv.amount) - num(inv.amountPaid)) * 100) / 100,
      issueDate: inv.issueDate.toISOString().slice(0, 10),
      dueDate: inv.dueDate?.toISOString().slice(0, 10) ?? null,
      daysOverdue: daysOverdue(inv.dueDate, now),
      paymentTerms: inv.paymentTerms,
      partialPaymentsAllowed: inv.allowPartial,
      minimumPartialPayment: inv.minAmountDue ? num(inv.minAmountDue) : null,
    },
    client: { name: client.name, company: client.company, country: client.country, notes: client.notes },
    freelancer: freelancer ?? null,
    previousContacts: contactHistory(inv).map((c) => ({ ...c, at: c.at.toISOString().slice(0, 10) })),
    clientPaymentHistory: history ?? null,
    today: now.toISOString().slice(0, 10),
  };
}
