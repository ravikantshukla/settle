/** Chronological history of one invoice, for the dashboard side panel. */
import { num, prisma } from "@/lib/db";
import { COLLECTIBLE_STATUSES } from "@/lib/agent/policy";
import { asRationale, type ActionRationale } from "@/lib/agent/rationale";
import { ACTION_LABEL } from "@/lib/format";

export type TimelineEventKind =
  | "created"
  | "sent"
  | "contact"
  | "proposal"
  | "scheduled"
  | "reply"
  | "payment"
  | "paid"
  | "payout"
  | "cancelled"
  | "failed";

export interface TimelineEvent {
  kind: TimelineEventKind;
  at: string;
  title: string;
  detail?: string;
  href?: string;
  /** For pending proposals: the facts the rules used ("Why this action?"). */
  rationale?: ActionRationale;
  /** Client replies: the pasted text (untrusted; render as plain text). */
  quote?: string;
}

export interface InvoiceTimeline {
  id: string;
  number: string;
  client: string;
  project: string;
  currency: string;
  amount: number;
  amountPaid: number;
  status: string;
  /** Still owed money: "Client replied" is available. */
  collectible: boolean;
  clientInfo: { id: string; timezone: string | null; country: string | null };
  isDemo: boolean;
  paypalInvoiceId: string | null;
  payerViewUrl: string | null;
  events: TimelineEvent[];
}

const shortDateTime = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
const fmt = (n: number, c: string) => new Intl.NumberFormat("en-US", { style: "currency", currency: c }).format(n);

export async function invoiceTimeline(invoiceId: string): Promise<InvoiceTimeline | null> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      project: { include: { client: true } },
      agentActions: true,
      payments: true,
      clientReplies: true,
      payoutSplits: { include: { subcontractor: true, payouts: true } },
    },
  });
  if (!inv) return null;
  const c = inv.currency;
  const events: TimelineEvent[] = [{ kind: "created", at: inv.issueDate.toISOString(), title: "Invoice created", detail: `${inv.number} · ${fmt(num(inv.amount), c)}` }];

  if (inv.sentAt) {
    events.push({
      kind: "sent",
      at: inv.sentAt.toISOString(),
      title: "Sent via PayPal",
      detail:
        inv.recipientEmail && inv.recipientEmail.toLowerCase() !== inv.project.client.email.toLowerCase()
          ? `To ${inv.recipientEmail} (demo: routed to sandbox buyer; client email ${inv.project.client.email})`
          : `To ${inv.recipientEmail ?? inv.project.client.email}`,
      href: inv.payerViewUrl ?? undefined,
    });
  }

  // Replies first: a proposal made from a reply has the same timestamp and should read after it.
  for (const r of inv.clientReplies) {
    const category = r.category.toLowerCase().replaceAll("_", " ");
    events.push({
      kind: "reply",
      at: r.receivedAt.toISOString(),
      title: `Client replied: ${category}${r.promisedDate ? ` (promised by ${r.promisedDate.toISOString().slice(0, 10)})` : ""}`,
      detail: r.summary ?? undefined,
      quote: r.text,
    });
  }

  for (const a of inv.agentActions) {
    if (a.type === "SEND_INVOICE" || a.type === "PAYOUT_SUBCONTRACTORS") continue;
    const payload = (a.payload ?? {}) as { subject?: string; message?: string; minimumAmount?: number };
    const label = ACTION_LABEL[a.type] ?? a.type;
    if (a.status === "EXECUTED") {
      events.push({
        kind: "contact",
        at: (a.executedAt ?? a.updatedAt).toISOString(),
        title: a.type === "OFFER_PAYMENT_PLAN" ? `Payment plan offered (min ${fmt(payload.minimumAmount ?? 0, c)})` : a.type === "ESCALATE" ? "Escalated for personal follow-up" : "Reminder sent",
        detail: payload.subject,
      });
    } else if (a.status === "PROPOSED") {
      events.push({ kind: "proposal", at: a.proposedAt.toISOString(), title: `Agent proposes: ${label}`, detail: a.reasoning ?? undefined, rationale: asRationale(a.rationale) ?? undefined });
    } else if (a.status === "SCHEDULED") {
      events.push({
        kind: "scheduled",
        at: (a.decidedAt ?? a.updatedAt).toISOString(),
        title: `${label} approved: sends ${a.scheduledFor ? shortDateTime(a.scheduledFor) : "soon"} (client's business hours)`,
        detail: payload.subject,
      });
    } else if (a.status === "FAILED") {
      events.push({ kind: "failed", at: a.updatedAt.toISOString(), title: `${label} failed`, detail: (a.result as { error?: string } | null)?.error });
    }
  }

  for (const p of inv.payments) {
    events.push({ kind: "payment", at: p.paidAt.toISOString(), title: `Payment received: ${fmt(num(p.amount), p.currency)}`, detail: p.method ?? undefined });
  }
  if (inv.paidAt && (inv.status === "PAID" || inv.status === "MARKED_AS_PAID")) {
    events.push({ kind: "paid", at: inv.paidAt.toISOString(), title: "Paid in full" });
  }
  if (inv.status === "CANCELLED") events.push({ kind: "cancelled", at: inv.updatedAt.toISOString(), title: "Cancelled" });

  for (const split of inv.payoutSplits) {
    for (const po of split.payouts) {
      events.push({
        kind: "payout",
        at: (po.paidOutAt ?? po.createdAt).toISOString(),
        title: `Payout to ${split.subcontractor.name}: ${fmt(num(po.amount), po.currency)}`,
        detail: [po.status.replaceAll("_", " ").toLowerCase(), po.payoutBatchId && `batch ${po.payoutBatchId}`, po.error].filter(Boolean).join(" · "),
      });
    }
  }
  const pendingPayout = inv.agentActions.find((a) => a.type === "PAYOUT_SUBCONTRACTORS" && a.status === "PROPOSED");
  if (pendingPayout) {
    events.push({ kind: "proposal", at: pendingPayout.proposedAt.toISOString(), title: "Agent proposes: subcontractor payout", detail: pendingPayout.reasoning ?? undefined, rationale: asRationale(pendingPayout.rationale) ?? undefined });
  }

  events.sort((a, b) => a.at.localeCompare(b.at));
  return {
    id: inv.id,
    number: inv.number,
    client: inv.project.client.company ?? inv.project.client.name,
    project: inv.project.title,
    currency: c,
    amount: num(inv.amount),
    amountPaid: num(inv.amountPaid),
    status: inv.status,
    collectible: COLLECTIBLE_STATUSES.includes(inv.status),
    clientInfo: { id: inv.project.client.id, timezone: inv.project.client.timezone, country: inv.project.client.country },
    isDemo: inv.isDemo,
    paypalInvoiceId: inv.paypalInvoiceId,
    payerViewUrl: inv.payerViewUrl,
    events,
  };
}
