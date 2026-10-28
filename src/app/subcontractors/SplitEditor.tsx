"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useToast } from "@/components/Toast";
import { validateSplits, totalCommitted } from "@/lib/agent/payoutShares";
import { sendJson } from "@/lib/api";
import { money } from "@/lib/format";

interface SplitRow {
  id?: string;
  subcontractorId: string;
  mode: "percentage" | "fixed";
  value: string;
  locked: boolean;
}

export interface EditableInvoice {
  id: string;
  number: string;
  status: string;
  currency: string;
  amount: number;
  isDemo: boolean;
  splits: SplitRow[];
}

const input = "rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0070ba]/40 disabled:bg-slate-50 disabled:text-slate-500";

export function SplitEditor({ invoice, subcontractors }: { invoice: EditableInvoice; subcontractors: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState<SplitRow[]>(invoice.splits);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(rows) !== JSON.stringify(invoice.splits);

  const parsed = rows.map((r) => ({
    percentage: r.mode === "percentage" && r.value !== "" ? Number(r.value) : null,
    fixedAmount: r.mode === "fixed" && r.value !== "" ? Number(r.value) : null,
  }));
  const error = useMemo(() => {
    if (rows.some((r) => !r.subcontractorId)) return "Choose a subcontractor for each split.";
    if (new Set(rows.map((r) => r.subcontractorId)).size !== rows.length) return "Each subcontractor can appear only once.";
    return validateSplits(invoice.amount, parsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, invoice.amount]);
  const committed = error ? null : totalCommitted(invoice.amount, parsed);

  const update = (i: number, patch: Partial<SplitRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    setSaving(true);
    try {
      await sendJson("PUT", `/api/invoices/${invoice.id}/splits`, {
        splits: rows.map((r, i) => ({ id: r.id, subcontractorId: r.subcontractorId, ...parsed[i] })),
      });
      toast.success(`Splits saved for ${invoice.number}`);
      router.refresh();
    } catch (e) {
      toast.error("Couldn't save splits", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{invoice.number}</span>
        <span className="text-slate-500">
          {money(invoice.amount, invoice.currency)} · {invoice.status.replaceAll("_", " ").toLowerCase()}
        </span>
        {committed !== null && rows.length > 0 && (
          <span className="ml-auto text-xs text-slate-500">
            Subcontractors get {money(committed, invoice.currency)} ({((committed / invoice.amount) * 100).toFixed(0)}%)
          </span>
        )}
      </div>

      {rows.length === 0 && <p className="text-xs text-slate-500">No splits — you keep 100%.</p>}
      {rows.map((r, i) => (
        <div key={r.id ?? `new-${i}`} className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[1.4fr_9rem_8rem_auto]">
          <select className={`${input} col-span-2 sm:col-span-1`} value={r.subcontractorId} disabled={r.locked} onChange={(e) => update(i, { subcontractorId: e.target.value })} aria-label="Subcontractor">
            <option value="">Choose…</option>
            {subcontractors.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select className={input} value={r.mode} disabled={r.locked} onChange={(e) => update(i, { mode: e.target.value as SplitRow["mode"] })} aria-label="Split type">
            <option value="percentage">% of total</option>
            <option value="fixed">Fixed {invoice.currency}</option>
          </select>
          <input className={input} type="number" min="0" step="any" value={r.value} disabled={r.locked} onChange={(e) => update(i, { value: e.target.value })} aria-label={r.mode === "percentage" ? "Percent" : "Amount"} />
          {r.locked ? (
            <span className="col-span-2 text-xs text-slate-500 sm:col-span-1" title="Payouts were made from this split">Paid out · locked</span>
          ) : (
            <button onClick={() => setRows(rows.filter((_, j) => j !== i))} className="col-span-2 justify-self-start rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-red-50 hover:text-red-700 sm:col-span-1">
              Remove
            </button>
          )}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setRows([...rows, { subcontractorId: "", mode: "percentage", value: "", locked: false }])}
          disabled={subcontractors.length === 0}
          className="text-xs font-medium text-[#0070ba] hover:underline disabled:text-slate-400 disabled:no-underline"
        >
          + Add split
        </button>
        {error && rows.length > 0 && <span className="text-xs text-red-700">{error}</span>}
        {dirty && (
          <div className="ml-auto flex gap-2">
            <button onClick={() => setRows(invoice.splits)} disabled={saving} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
              Discard
            </button>
            <button onClick={save} disabled={saving || !!error} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
              {saving ? "Saving…" : "Save splits"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
