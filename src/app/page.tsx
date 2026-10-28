import Link from "next/link";
import { LoadDemoButton } from "@/components/LoadDemoButton";
import { OnboardingBanner } from "@/components/OnboardingBanner";
import { RefreshRiskButton } from "@/components/RefreshRiskButton";
import { SyncButton } from "@/components/SyncButton";
import { money } from "@/lib/format";
import { dashboardData } from "@/lib/invoices/dashboard";
import { DashboardGrid } from "./DashboardGrid";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "Dashboard · Settle" } };

function Kpi({ label, value, hint, tone = "default", href }: { label: string; value: string; hint?: string; tone?: "default" | "danger" | "good" | "accent"; href?: string }) {
  const valueColor = { default: "text-slate-900", danger: "text-red-700", good: "text-emerald-700", accent: "text-[#0070ba]" }[tone];
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${valueColor}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </>
  );
  const cls = "rounded-xl border border-slate-200 bg-white px-4 py-3";
  return href ? (
    <Link href={href} className={`${cls} transition hover:border-[#0070ba]/40 hover:shadow-sm`}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export default async function DashboardPage() {
  const { rows, kpis } = await dashboardData();
  const c = kpis.currency;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Receivables</h1>
          <p className="mt-1 text-sm text-slate-600">Everything clients owe you, how late it is, and what the agent suggests next.</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
          <SyncButton />
          <RefreshRiskButton />
          <Link href="/invoices/new" className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
            New invoice
          </Link>
        </div>
      </div>

      <OnboardingBanner />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Outstanding" value={money(kpis.totalOutstanding, c)} hint={`${rows.filter((r) => r.outstanding > 0).length} open invoice(s)`} />
        <Kpi label="Overdue" value={money(kpis.overdueAmount, c)} hint={`${kpis.overdueCount} invoice(s) past due`} tone={kpis.overdueAmount > 0 ? "danger" : "default"} />
        <Kpi label="Collected this month" value={money(kpis.collectedThisMonth, c)} tone="good" />
        <Kpi label="Avg. days to pay" value={kpis.averageDaysToPay === null ? "—" : `${kpis.averageDaysToPay} days`} hint="Issue date → paid in full" />
        <Kpi label="Pending approvals" value={String(kpis.pendingActions)} hint="Review in the agent inbox →" tone={kpis.pendingActions ? "accent" : "default"} href="/agent" />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <p className="font-medium">No invoices yet</p>
          <p className="mt-1 text-sm text-slate-500">Paste a project agreement and Settle drafts the PayPal invoice for you.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link href="/invoices/new" className="rounded-lg bg-[#0070ba] px-4 py-2 text-sm font-semibold text-white hover:bg-[#005ea6]">
              Create your first invoice
            </Link>
            {process.env.DEMO_MODE === "true" && <LoadDemoButton />}
          </div>
        </div>
      ) : (
        <DashboardGrid rows={rows} />
      )}
    </div>
  );
}
