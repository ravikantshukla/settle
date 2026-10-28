"use client";

import type { ColDef, ColGroupDef, GridApi, ICellRendererParams, IRowNode, CellClickedEvent } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { gridTheme } from "@/components/grid/theme";
import { StatusPill } from "@/components/StatusPill";
import { useToast } from "@/components/Toast";
import { postJson } from "@/lib/api";
import { ACTION_LABEL, ACTION_STYLE, money, shortDate } from "@/lib/format";
import { AGING_ORDER, type AgingBucket, type DashboardRow } from "@/lib/invoices/dashboardTypes";
import { InvoicePanel } from "./InvoicePanel";

type Row = DashboardRow | (Partial<DashboardRow> & { id: string; isTotal: true });
const isTotal = (r: Row | undefined): r is Extract<Row, { isTotal: true }> => !!r && "isTotal" in r;

const BUCKET_STYLE: Record<AgingBucket, string> = {
  Current: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  "1–30": "bg-amber-50 text-amber-700 ring-amber-200",
  "31–60": "bg-orange-50 text-orange-700 ring-orange-200",
  "60+": "bg-red-50 text-red-700 ring-red-200",
  Paid: "bg-slate-50 text-slate-600 ring-slate-200",
  Draft: "bg-slate-50 text-slate-600 ring-slate-200",
  Closed: "bg-slate-50 text-slate-500 ring-slate-200",
};
const CHIP_BUCKETS: AgingBucket[] = ["Current", "1–30", "31–60", "60+", "Paid"];

// ---------------------------------------------------------------------------
// Cell renderers
// ---------------------------------------------------------------------------

function InvoiceCell({ data }: ICellRendererParams<Row>) {
  if (!data) return null;
  if (isTotal(data)) return <span className="font-semibold">Total ({data.number})</span>;
  return (
    <div className="flex flex-col justify-center leading-tight">
      <span className="font-medium">
        {data.number}
        {data.isDemo && <span className="ml-1.5 rounded bg-violet-100 px-1 py-px text-[10px] font-semibold text-violet-800">DEMO</span>}
      </span>
      <span className="truncate text-xs text-slate-500">{data.project}</span>
    </div>
  );
}

function StatusCell({ data }: ICellRendererParams<Row>) {
  if (!data || isTotal(data)) return null;
  return <StatusPill status={data.status!} />;
}

function BucketCell({ data }: ICellRendererParams<Row>) {
  if (!data || isTotal(data)) return null;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BUCKET_STYLE[data.bucket!]}`}>{data.bucket}</span>;
}

function RiskCell({ data }: ICellRendererParams<Row>) {
  if (!data || isTotal(data) || !data.risk) {
    return data && !isTotal(data) && data.outstanding ? <span className="text-xs text-slate-400">Not scored yet</span> : null;
  }
  const { score, reason, sample } = data.risk;
  const tone = score >= 70 ? "bg-red-500" : score >= 40 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="flex flex-col justify-center gap-1 leading-tight" title={reason}>
      <div className="flex items-center gap-2">
        <span className="w-7 text-right font-semibold tabular-nums">{score}</span>
        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
          <span className={`block h-full ${tone}`} style={{ width: `${score}%` }} />
        </span>
        {sample && <span className="text-[10px] font-medium text-slate-400">sample</span>}
      </div>
      <span className="truncate text-xs text-slate-500">{reason}</span>
    </div>
  );
}

function NextActionCell({ data, context }: ICellRendererParams<Row, unknown, GridContext>) {
  const [busy, setBusy] = useState<null | "approve" | "reject">(null);
  if (!data || isTotal(data) || !data.nextAction) return null;
  const a = data.nextAction;
  const run = async (kind: "approve" | "reject") => {
    setBusy(kind);
    try {
      await context.decide(a.id, kind, data.number!);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex h-full items-center gap-2">
      <div className="min-w-0 flex-1 leading-tight">
        <span className={`rounded px-1.5 py-px text-[10px] font-semibold ${ACTION_STYLE[a.type] ?? "bg-slate-100"}`}>{ACTION_LABEL[a.type] ?? a.type}</span>
        <p className="truncate text-xs text-slate-600" title={a.summary}>{a.summary}</p>
      </div>
      <button
        onClick={() => run("approve")}
        disabled={!!busy}
        className="rounded-md bg-[#0070ba] px-2 py-1 text-xs font-semibold text-white hover:bg-[#005ea6] disabled:opacity-60"
      >
        {busy === "approve" ? "…" : "Approve"}
      </button>
      <button
        onClick={() => run("reject")}
        disabled={!!busy}
        aria-label="Reject"
        className="rounded-md px-1.5 py-1 text-xs text-slate-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-60"
      >
        {busy === "reject" ? "…" : "Reject"}
      </button>
    </div>
  );
}

interface GridContext {
  decide: (actionId: string, kind: "approve" | "reject", invoiceNumber: string) => Promise<void>;
}

// ---------------------------------------------------------------------------

const moneyCol = (field: "amount" | "paid" | "outstanding", headerName: string): ColDef<Row> => ({
  field,
  headerName,
  type: "rightAligned",
  filter: "agNumberColumnFilter",
  width: 125,
  valueFormatter: (p) => (p.value === undefined || p.value === null ? "" : money(p.value, p.data?.currency ?? "USD")),
  cellClass: (p) => (field === "outstanding" && p.value > 0 ? "font-semibold tabular-nums" : "tabular-nums"),
});

export function DashboardGrid({ rows }: { rows: DashboardRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const apiRef = useRef<GridApi<Row> | null>(null);
  const bucketRef = useRef<AgingBucket | "All">("All");
  const [bucket, setBucket] = useState<AgingBucket | "All">("All");
  const [search, setSearch] = useState("");
  const [totals, setTotals] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const context = useMemo<GridContext>(
    () => ({
      async decide(actionId, kind, invoiceNumber) {
        try {
          if (kind === "approve") {
            const r = await postJson<{ message: string; simulated: boolean }>(`/api/agent/actions/${actionId}/approve`, {});
            toast.success(r.simulated ? `${invoiceNumber}: done (demo, simulated)` : `${invoiceNumber}: done via PayPal`, r.message);
          } else {
            await postJson(`/api/agent/actions/${actionId}/reject`, {});
            toast.info(`${invoiceNumber}: proposal rejected`);
          }
        } catch (e) {
          toast.error(`${invoiceNumber}: ${kind} failed`, e instanceof Error ? e.message : String(e));
        }
        router.refresh();
      },
    }),
    [router, toast],
  );

  const columnDefs = useMemo<(ColDef<Row> | ColGroupDef<Row>)[]>(
    () => [
      {
        headerName: "Invoice",
        children: [
          { field: "client", headerName: "Client", filter: "agTextColumnFilter", minWidth: 150, flex: 1, cellClass: "font-medium" },
          { field: "number", headerName: "Invoice #", filter: "agTextColumnFilter", width: 190, cellRenderer: InvoiceCell },
          { field: "status", headerName: "Status", filter: "agTextColumnFilter", width: 140, cellRenderer: StatusCell },
        ],
      },
      {
        headerName: "Amounts",
        children: [moneyCol("amount", "Amount"), moneyCol("paid", "Paid"), moneyCol("outstanding", "Outstanding")],
      },
      {
        headerName: "Aging",
        children: [
          {
            field: "dueDate",
            headerName: "Due",
            width: 120,
            filter: "agDateColumnFilter",
            filterParams: {
              comparator: (filterDate: Date, cell: string | null) => {
                if (!cell) return -1;
                const d = new Date(`${cell}T00:00:00`);
                return d < filterDate ? -1 : d > filterDate ? 1 : 0;
              },
            },
            valueFormatter: (p) => (p.data && isTotal(p.data) ? "" : shortDate(p.value)),
          },
          {
            field: "daysOverdue",
            headerName: "Days overdue",
            type: "rightAligned",
            width: 125,
            filter: "agNumberColumnFilter",
            valueFormatter: (p) => (p.value === null || p.value === undefined ? "" : p.value > 0 ? String(p.value) : p.value === 0 ? "due today" : `in ${-p.value}d`),
            cellClass: (p) => (p.value > 0 ? "font-semibold text-red-700 tabular-nums" : "text-slate-500 tabular-nums"),
          },
          {
            field: "bucket",
            headerName: "Aging bucket",
            width: 130,
            filter: "agTextColumnFilter",
            cellRenderer: BucketCell,
            comparator: (a: AgingBucket, b: AgingBucket) => AGING_ORDER.indexOf(a) - AGING_ORDER.indexOf(b),
          },
        ],
      },
      {
        headerName: "AI",
        children: [
          {
            colId: "risk",
            headerName: "Risk",
            width: 220,
            valueGetter: (p) => (p.data && !isTotal(p.data) ? (p.data.risk?.score ?? null) : null),
            filter: "agNumberColumnFilter",
            cellRenderer: RiskCell,
          },
          { colId: "riskReason", headerName: "Risk reason", hide: true, valueGetter: (p) => (p.data && !isTotal(p.data) ? (p.data.risk?.reason ?? "") : "") },
        ],
      },
      {
        headerName: "Agent",
        children: [
          {
            colId: "nextAction",
            headerName: "Next proposed action",
            minWidth: 300,
            flex: 1.4,
            sortable: false,
            valueGetter: (p) => (p.data && !isTotal(p.data) && p.data.nextAction ? `${ACTION_LABEL[p.data.nextAction.type]}: ${p.data.nextAction.summary}` : ""),
            cellRenderer: NextActionCell,
          },
        ],
      },
    ],
    [],
  );

  const defaultColDef = useMemo<ColDef<Row>>(() => ({ sortable: true, resizable: true, filter: true, floatingFilter: false }), []);

  const recomputeTotals = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    let count = 0, amount = 0, paid = 0, outstanding = 0;
    api.forEachNodeAfterFilter((n: IRowNode<Row>) => {
      if (!n.data || isTotal(n.data)) return;
      count++;
      amount += n.data.amount ?? 0;
      paid += n.data.paid ?? 0;
      outstanding += n.data.outstanding ?? 0;
    });
    setTotals([{ id: "total", isTotal: true, number: `${count}`, amount, paid, outstanding, currency: rows[0]?.currency ?? "USD" }]);
  }, [rows]);

  const chooseBucket = (b: AgingBucket | "All") => {
    bucketRef.current = b;
    setBucket(b);
    apiRef.current?.onFilterChanged();
  };

  const counts = useMemo(() => {
    const m = new Map<AgingBucket, { n: number; outstanding: number }>();
    for (const r of rows) {
      const c = m.get(r.bucket) ?? { n: 0, outstanding: 0 };
      m.set(r.bucket, { n: c.n + 1, outstanding: c.outstanding + r.outstanding });
    }
    return m;
  }, [rows]);

  function exportCsv() {
    apiRef.current?.exportDataAsCsv({
      fileName: `settle-receivables-${new Date().toISOString().slice(0, 10)}.csv`,
      columnKeys: ["client", "number", "status", "amount", "paid", "outstanding", "dueDate", "daysOverdue", "bucket", "risk", "riskReason", "nextAction"],
      skipPinnedBottom: true,
      processCellCallback: (p) => (["amount", "paid", "outstanding"].includes(p.column.getColId()) ? String(p.value ?? "") : (p.value ?? "")),
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by aging bucket">
          {(["All", ...CHIP_BUCKETS] as const).map((b) => {
            const c = b === "All" ? { n: rows.length, outstanding: 0 } : (counts.get(b) ?? { n: 0, outstanding: 0 });
            const active = bucket === b;
            return (
              <button
                key={b}
                onClick={() => chooseBucket(b)}
                aria-pressed={active}
                className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition ${
                  active ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
                }`}
              >
                {b === "All" ? "All" : b === "Current" ? "Current" : b === "Paid" ? "Paid" : `${b} days`}
                <span className={`ml-1.5 ${active ? "text-slate-300" : "text-slate-400"}`}>{c.n}</span>
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex w-full gap-2 sm:w-auto">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoices…"
            aria-label="Search invoices"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0070ba]/40 sm:w-56"
          />
          <button onClick={exportCsv} className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
            Export CSV
          </button>
        </div>
      </div>

      <div className="h-[560px]">
        <AgGridReact<Row>
          theme={gridTheme}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          context={context}
          getRowId={(p) => p.data.id}
          rowHeight={54}
          headerHeight={36}
          groupHeaderHeight={30}
          quickFilterText={search}
          pinnedBottomRowData={totals}
          isExternalFilterPresent={() => bucketRef.current !== "All"}
          doesExternalFilterPass={(n) => !!n.data && !isTotal(n.data) && n.data.bucket === bucketRef.current}
          onGridReady={(e) => {
            apiRef.current = e.api;
            recomputeTotals();
          }}
          onModelUpdated={recomputeTotals}
          onCellClicked={(e: CellClickedEvent<Row>) => {
            if (e.column.getColId() === "nextAction" || !e.data || isTotal(e.data)) return;
            setSelected(e.data.id);
          }}
          rowClass="cursor-pointer"
          getRowClass={(p) => (p.node.rowPinned ? "!cursor-default bg-slate-50 font-semibold" : undefined)}
          overlayNoRowsTemplate='<span class="text-sm text-slate-500">No invoices match. Clear the search or pick another bucket.</span>'
          suppressCellFocus
          animateRows
        />
      </div>

      <InvoicePanel invoiceId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
