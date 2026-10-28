import Link from "next/link";
import { SyncButton } from "@/components/SyncButton";
import { num, prisma } from "@/lib/db";
import { money } from "@/lib/format";
import { PayoutsGrid, type PayoutRow } from "./PayoutsGrid";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payouts" };

const IN_FLIGHT = ["PENDING", "UNCLAIMED", "ONHOLD"];
const PROBLEM = ["FAILED", "RETURNED", "BLOCKED", "REVERSED", "REFUNDED"];

export default async function PayoutsPage() {
  const [payouts, pending] = await Promise.all([
    prisma.payout.findMany({
      orderBy: { createdAt: "desc" },
      include: { split: { include: { subcontractor: true, invoice: { include: { project: { include: { client: true } } } } } } },
    }),
    prisma.agentAction.count({ where: { type: "PAYOUT_SUBCONTRACTORS", status: "PROPOSED" } }),
  ]);

  const rows: PayoutRow[] = payouts.map((p) => ({
    id: p.id,
    date: (p.paidOutAt ?? p.createdAt).toISOString(),
    subcontractor: p.split.subcontractor.name,
    email: p.split.subcontractor.paypalEmail,
    invoice: p.split.invoice.number,
    client: p.split.invoice.project.client.company ?? p.split.invoice.project.client.name,
    amount: num(p.amount),
    currency: p.currency,
    status: p.status,
    batchId: p.payoutBatchId,
    itemId: p.payoutItemId,
    error: p.error,
    isDemo: p.isDemo,
  }));

  const sum = (pred: (r: PayoutRow) => boolean) => rows.filter(pred).reduce((s, r) => s + r.amount, 0);
  const currency = rows[0]?.currency ?? "USD";
  const card = "rounded-xl border border-slate-200 bg-white px-4 py-3";
  const label = "text-xs font-medium uppercase tracking-wide text-slate-500";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Payouts</h1>
          <p className="mt-1 text-sm text-slate-600">Subcontractor payouts sent through PayPal Payouts after you approved them.</p>
        </div>
        <div className="flex gap-2 sm:ml-auto">
          <SyncButton />
          <Link href="/subcontractors" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
            Manage splits
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className={card}>
          <p className={label}>Paid out</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700">{money(sum((r) => r.status === "SUCCESS"), currency)}</p>
        </div>
        <div className={card}>
          <p className={label}>In flight</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{money(sum((r) => IN_FLIGHT.includes(r.status)), currency)}</p>
        </div>
        <div className={card}>
          <p className={label}>Failed or returned</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{rows.filter((r) => PROBLEM.includes(r.status)).length}</p>
        </div>
        <Link href="/agent" className={`${card} transition hover:border-[#0070ba]/40 hover:shadow-sm`}>
          <p className={label}>Awaiting approval</p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${pending ? "text-[#0070ba]" : ""}`}>{pending}</p>
          <p className="mt-0.5 text-xs text-slate-500">Review in the agent inbox →</p>
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <p className="font-medium">No payouts yet</p>
          <p className="mt-1 text-sm text-slate-500">
            When a client pays an invoice with subcontractor splits, the agent proposes a payout for you to approve.
          </p>
        </div>
      ) : (
        <PayoutsGrid rows={rows} />
      )}
    </div>
  );
}
