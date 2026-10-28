import Link from "next/link";
import { SyncButton } from "@/components/SyncButton";
import { num, prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  PAID: "bg-emerald-100 text-emerald-800",
  MARKED_AS_PAID: "bg-emerald-100 text-emerald-800",
  PARTIALLY_PAID: "bg-sky-100 text-sky-800",
  CANCELLED: "bg-slate-200 text-slate-600",
  DRAFT: "bg-slate-100 text-slate-700",
};

export default async function InvoicesPage() {
  const invoices = await prisma.invoice.findMany({
    orderBy: { issueDate: "desc" },
    include: { project: { include: { client: true } } },
  });
  const now = Date.now();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
        <div className="ml-auto flex items-center gap-3">
          <SyncButton />
          <Link href="/invoices/new" className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
            New invoice
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Invoice</th>
              <th className="px-4 py-2 font-medium">Client</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
              <th className="px-4 py-2 text-right font-medium">Paid</th>
              <th className="px-4 py-2 font-medium">Due</th>
              <th className="px-4 py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoices.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  No invoices yet. Run <code>npm run db:seed</code> for demo data or create one.
                </td>
              </tr>
            )}
            {invoices.map((inv) => {
              const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: inv.currency });
              const open = !["PAID", "MARKED_AS_PAID", "CANCELLED", "REFUNDED", "MARKED_AS_REFUNDED"].includes(inv.status);
              const daysOverdue = inv.dueDate && open ? Math.floor((now - inv.dueDate.getTime()) / 86_400_000) : 0;
              return (
                <tr key={inv.id}>
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{inv.number}</span>
                    {inv.isDemo && <span className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800">DEMO</span>}
                    <div className="text-xs text-slate-500">{inv.project.title}</div>
                  </td>
                  <td className="px-4 py-2.5">{inv.project.client.company ?? inv.project.client.name}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLE[inv.status] ?? "bg-amber-100 text-amber-800"}`}>
                      {inv.status.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmt.format(num(inv.amount))}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmt.format(num(inv.amountPaid))}</td>
                  <td className="px-4 py-2.5">
                    {inv.dueDate?.toISOString().slice(0, 10) ?? "—"}
                    {daysOverdue > 0 && <span className="ml-2 text-xs font-medium text-red-700">{daysOverdue}d overdue</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {inv.payerViewUrl && (
                      <a href={inv.payerViewUrl} target="_blank" rel="noreferrer" className="text-xs text-[#0070ba] hover:underline">
                        PayPal ↗
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
