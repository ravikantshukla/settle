"use client";

import type { ColDef, GridApi, ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useMemo, useRef, useState } from "react";
import { gridTheme } from "@/components/grid/theme";
import { StatusPill } from "@/components/StatusPill";
import { money, shortDate } from "@/lib/format";

export interface PayoutRow {
  id: string;
  date: string;
  subcontractor: string;
  email: string;
  invoice: string;
  client: string;
  amount: number;
  currency: string;
  status: string;
  batchId: string | null;
  itemId: string | null;
  error: string | null;
}

function RecipientCell({ data }: ICellRendererParams<PayoutRow>) {
  if (!data) return null;
  return (
    <div className="flex flex-col justify-center leading-tight">
      <span className="font-medium">{data.subcontractor}</span>
      <span className="truncate text-xs text-slate-500">{data.email}</span>
    </div>
  );
}

function StatusCell({ data }: ICellRendererParams<PayoutRow>) {
  if (!data) return null;
  return (
    <span className="flex items-center gap-1.5" title={data.error ?? undefined}>
      <StatusPill status={data.status} />
    </span>
  );
}

export function PayoutsGrid({ rows }: { rows: PayoutRow[] }) {
  const apiRef = useRef<GridApi<PayoutRow> | null>(null);
  const [search, setSearch] = useState("");

  const columnDefs = useMemo<ColDef<PayoutRow>[]>(
    () => [
      { field: "date", headerName: "Date", width: 130, sort: "desc", valueFormatter: (p) => shortDate(p.value) },
      { field: "subcontractor", headerName: "Recipient", minWidth: 200, flex: 1, cellRenderer: RecipientCell, filter: "agTextColumnFilter" },
      { field: "invoice", headerName: "Invoice", width: 130, filter: "agTextColumnFilter" },
      { field: "client", headerName: "Client", minWidth: 160, flex: 1, filter: "agTextColumnFilter" },
      {
        field: "amount",
        headerName: "Amount",
        type: "rightAligned",
        width: 130,
        filter: "agNumberColumnFilter",
        cellClass: "font-semibold tabular-nums",
        valueFormatter: (p) => money(p.value, p.data?.currency ?? "USD"),
      },
      { field: "status", headerName: "Status", width: 180, cellRenderer: StatusCell, filter: "agTextColumnFilter" },
      { field: "batchId", headerName: "PayPal batch", width: 190, cellClass: "font-mono text-xs", filter: "agTextColumnFilter" },
      { field: "itemId", headerName: "Item", width: 170, cellClass: "font-mono text-xs" },
      { field: "email", hide: true },
      { field: "error", hide: true },
    ],
    [],
  );

  function exportCsv() {
    apiRef.current?.exportDataAsCsv({
      // eslint-disable-next-line no-restricted-syntax -- download filename only
      fileName: `settle-payouts-${new Date().toISOString().slice(0, 10)}.csv`,
      columnKeys: ["date", "subcontractor", "email", "invoice", "client", "amount", "status", "batchId", "itemId", "error"],
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search payouts…"
          aria-label="Search payouts"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0070ba]/40 sm:w-64"
        />
        <button onClick={exportCsv} className="ml-auto rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
          Export CSV
        </button>
      </div>
      <div className="h-[480px]">
        <AgGridReact<PayoutRow>
          theme={gridTheme}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, resizable: true }}
          getRowId={(p) => p.data.id}
          rowHeight={50}
          quickFilterText={search}
          onGridReady={(e) => {
            apiRef.current = e.api;
          }}
          overlayNoRowsTemplate='<span class="text-sm text-slate-500">No payouts match your search.</span>'
          suppressCellFocus
        />
      </div>
    </div>
  );
}
