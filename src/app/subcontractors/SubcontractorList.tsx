"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/Toast";
import { sendJson } from "@/lib/api";
import { money } from "@/lib/format";

export interface SubRow {
  id: string;
  name: string;
  paypalEmail: string;
  isDemo: boolean;
  splitCount: number;
  paidOut: number;
}

const input = "w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0070ba]/40";

export function SubcontractorList({ rows }: { rows: SubRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", paypalEmail: "" });
  const [busy, setBusy] = useState(false);

  function startEdit(row: SubRow | null) {
    setEditingId(row?.id ?? "new");
    setDraft({ name: row?.name ?? "", paypalEmail: row?.paypalEmail ?? "" });
  }

  async function save() {
    setBusy(true);
    try {
      if (editingId === "new") await sendJson("POST", "/api/subcontractors", draft);
      else await sendJson("PATCH", `/api/subcontractors/${editingId}`, draft);
      toast.success(editingId === "new" ? "Subcontractor added" : "Subcontractor updated", draft.name);
      setEditingId(null);
      router.refresh();
    } catch (e) {
      toast.error("Couldn't save subcontractor", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <div className="grid gap-2 sm:grid-cols-[1fr_1.3fr_auto]">
      <input className={input} placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Name" />
      <input className={input} type="email" placeholder="PayPal email" value={draft.paypalEmail} onChange={(e) => setDraft({ ...draft, paypalEmail: e.target.value })} aria-label="PayPal email" />
      <div className="flex gap-2">
        <button onClick={save} disabled={busy} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
          {busy ? "Saving…" : "Save"}
        </button>
        <button onClick={() => setEditingId(null)} disabled={busy} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <section className="space-y-3">
      <div className="flex items-center">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">People</h2>
        {editingId === null && (
          <button onClick={() => startEdit(null)} className="ml-auto rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
            + Add subcontractor
          </button>
        )}
      </div>
      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {editingId === "new" && <div className="p-4">{form}</div>}
        {rows.length === 0 && editingId !== "new" && (
          <p className="px-4 py-8 text-center text-sm text-slate-500">No subcontractors yet. Add one, or they&apos;re created automatically from an agreement.</p>
        )}
        {rows.map((r) =>
          editingId === r.id ? (
            <div key={r.id} className="p-4">{form}</div>
          ) : (
            <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {r.name}
                  {r.isDemo && <span className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800">DEMO</span>}
                </p>
                <p className="truncate text-xs text-slate-500">{r.paypalEmail}</p>
              </div>
              <span className="text-xs text-slate-500">{r.splitCount} split(s)</span>
              <span className="text-xs text-slate-500">Paid out <b className="text-slate-800">{money(r.paidOut)}</b></span>
              <button onClick={() => startEdit(r)} disabled={editingId !== null} className="rounded-md px-2 py-1 text-xs font-medium text-[#0070ba] hover:bg-sky-50 disabled:opacity-40">
                Edit
              </button>
            </div>
          ),
        )}
      </div>
    </section>
  );
}
