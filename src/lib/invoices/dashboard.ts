/**
 * Server-side data for the receivables dashboard. No AI calls here: risk scores are computed by
 * the rules; the one-line reason comes from the cache (or the rule drivers if stale/missing).
 */
import { clock } from "@/lib/clock";
import { num, prisma } from "@/lib/db";
import { agentInvoiceInclude, clientHistories } from "@/lib/agent/context";
import { COLLECTIBLE_STATUSES, daysOverdue, DAY_MS } from "@/lib/agent/policy";
import { riskFor, ruleReason } from "@/lib/agent/risk";
import { money } from "@/lib/format";
import type { AgingBucket, DashboardRow, Kpis } from "./dashboardTypes";

function bucketFor(status: string, overdue: number | null): AgingBucket {
  if (status === "PAID" || status === "MARKED_AS_PAID") return "Paid";
  if (status === "DRAFT" || status === "SCHEDULED") return "Draft";
  if (!COLLECTIBLE_STATUSES.includes(status as never)) return "Closed";
  if (overdue === null || overdue <= 0) return "Current";
  if (overdue <= 30) return "1–30";
  if (overdue <= 60) return "31–60";
  return "60+";
}

export async function dashboardData(): Promise<{ rows: DashboardRow[]; kpis: Kpis; now: string }> {
  const now = await clock.now();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [invoices, pendingActions, collected] = await Promise.all([
    prisma.invoice.findMany({
      orderBy: { issueDate: "desc" },
      include: { ...agentInvoiceInclude, risk: true },
    }),
    prisma.agentAction.count({ where: { status: "PROPOSED" } }),
    prisma.invoicePayment.findMany({ where: { paidAt: { gte: monthStart } }, select: { amount: true } }),
  ]);

  const histories = await clientHistories([...new Set(invoices.map((i) => i.project.clientId))]);

  const rows: DashboardRow[] = invoices.map((inv) => {
    const open = COLLECTIBLE_STATUSES.includes(inv.status);
    const overdue = open && inv.dueDate ? daysOverdue(inv.dueDate, now) : null;
    const amount = num(inv.amount);
    const paid = num(inv.amountPaid);
    const next = inv.agentActions.filter((a) => a.status === "PROPOSED").sort((a, b) => a.proposedAt.getTime() - b.proposedAt.getTime())[0];
    const risk = riskFor(inv, histories.get(inv.project.clientId)?.(inv.id), now);
    const cached = risk && inv.risk?.fingerprint === risk.fingerprint ? inv.risk : null;
    const p = (next?.payload ?? {}) as { subject?: string; items?: Array<{ amount: number }>; minimumAmount?: number };
    const summary =
      next?.type === "PAYOUT_SUBCONTRACTORS"
        ? `Pay ${money((p.items ?? []).reduce((s, i) => s + i.amount, 0), inv.currency)} to ${p.items?.length ?? 0} subcontractor(s)`
        : next?.type === "OFFER_PAYMENT_PLAN"
          ? `Offer installments (min ${money(p.minimumAmount ?? 0, inv.currency)})`
          : (p.subject ?? next?.reasoning ?? "");
    return {
      id: inv.id,
      client: inv.project.client.company ?? inv.project.client.name,
      project: inv.project.title,
      number: inv.number,
      status: inv.status,
      currency: inv.currency,
      amount,
      paid,
      outstanding: open ? Math.round((amount - paid) * 100) / 100 : 0,
      dueDate: inv.dueDate?.toISOString().slice(0, 10) ?? null,
      daysOverdue: overdue,
      bucket: bucketFor(inv.status, overdue),
      risk: risk ? { score: risk.score, reason: cached?.reason ?? ruleReason(risk), aiReason: !!cached?.model } : null,
      nextAction: next ? { id: next.id, type: next.type, summary } : null,
      payerViewUrl: inv.payerViewUrl,
      isDemo: inv.isDemo,
    };
  });

  const paidInvoices = invoices.filter((i) => i.paidAt && (i.status === "PAID" || i.status === "MARKED_AS_PAID"));
  const daysToPay = paidInvoices.map((i) => (i.paidAt!.getTime() - i.issueDate.getTime()) / DAY_MS);
  const currencies = rows.map((r) => r.currency);
  const currency = currencies.sort((a, b) => currencies.filter((c) => c === b).length - currencies.filter((c) => c === a).length)[0] ?? "USD";

  return {
    now: now.toISOString(),
    rows,
    kpis: {
      currency,
      totalOutstanding: rows.reduce((s, r) => s + r.outstanding, 0),
      overdueAmount: rows.filter((r) => (r.daysOverdue ?? 0) > 0).reduce((s, r) => s + r.outstanding, 0),
      overdueCount: rows.filter((r) => (r.daysOverdue ?? 0) > 0).length,
      collectedThisMonth: collected.reduce((s, p) => s + num(p.amount), 0),
      averageDaysToPay: daysToPay.length ? Math.round(daysToPay.reduce((a, b) => a + b, 0) / daysToPay.length) : null,
      pendingActions,
    },
  };
}
