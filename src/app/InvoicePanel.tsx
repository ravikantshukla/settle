"use client";

import { useEffect, useState } from "react";
import { StatusPill } from "@/components/StatusPill";
import { money, shortDate } from "@/lib/format";
import type { InvoiceTimeline, TimelineEventKind } from "@/lib/invoices/timeline";

const DOT: Record<TimelineEventKind, string> = {
  created: "bg-slate-400",
  sent: "bg-[#0070ba]",
  contact: "bg-sky-500",
  proposal: "bg-amber-400 ring-2 ring-amber-100",
  payment: "bg-emerald-500",
  paid: "bg-emerald-600",
  payout: "bg-violet-500",
  cancelled: "bg-slate-500",
  failed: "bg-red-500",
};

export function InvoicePanel({ invoiceId, onClose }: { invoiceId: string | null; onClose: () => void }) {
  const [state, setState] = useState<{ id: string; data?: InvoiceTimeline; error?: string } | null>(null);

  useEffect(() => {
    if (!invoiceId) return;
    let cancelled = false;
    setState({ id: invoiceId });
    fetch(`/api/invoices/${invoiceId}/timeline`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Failed to load");
        if (!cancelled) setState({ id: invoiceId, data: body });
      })
      .catch((e) => !cancelled && setState({ id: invoiceId, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  useEffect(() => {
    if (!invoiceId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [invoiceId, onClose]);

  if (!invoiceId) return null;
  const t = state?.data;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Invoice timeline">
      <button className="absolute inset-0 bg-slate-900/20" aria-label="Close" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-md flex-col overflow-hidden bg-white shadow-2xl">
        <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0 flex-1">
            {t ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">{t.number}</h2>
                  <StatusPill status={t.status} />
                  {t.isDemo && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800">DEMO</span>}
                </div>
                <p className="truncate text-sm text-slate-600">
                  {t.client} · {t.project}
                </p>
              </>
            ) : (
              <div className="h-10 w-48 animate-pulse rounded bg-slate-100" />
            )}
          </div>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Close panel">
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">Couldn&apos;t load the timeline: {state.error}</p>}
          {!t && !state?.error && (
            <div className="space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded bg-slate-100" />
              ))}
            </div>
          )}
          {t && (
            <>
              <dl className="mb-5 grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-lg bg-slate-50 p-3">
                  <dt className="text-xs text-slate-500">Amount</dt>
                  <dd className="font-semibold tabular-nums">{money(t.amount, t.currency)}</dd>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <dt className="text-xs text-slate-500">Paid</dt>
                  <dd className="font-semibold tabular-nums">{money(t.amountPaid, t.currency)}</dd>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <dt className="text-xs text-slate-500">Outstanding</dt>
                  <dd className="font-semibold tabular-nums">{money(Math.max(0, t.amount - t.amountPaid), t.currency)}</dd>
                </div>
              </dl>

              <ol className="relative space-y-4 border-l border-slate-200 pl-5">
                {t.events.map((e, i) => (
                  <li key={i} className="relative">
                    <span className={`absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ${DOT[e.kind]}`} />
                    <p className="text-sm font-medium">
                      {e.title}
                    </p>
                    <p className="text-xs text-slate-500">{shortDate(e.at)}</p>
                    {e.detail && <p className="mt-0.5 text-sm text-slate-600">{e.detail}</p>}
                    {e.href && (
                      <a href={e.href} target="_blank" rel="noreferrer" className="mt-0.5 inline-block text-xs font-medium text-[#0070ba] hover:underline">
                        Open in PayPal ↗
                      </a>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>

        {t && (t.payerViewUrl || t.paypalInvoiceId) && (
          <footer className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
            {t.paypalInvoiceId && (
              <p>
                PayPal invoice <span className="font-mono">{t.paypalInvoiceId}</span>
              </p>
            )}
            {t.payerViewUrl && (
              <a href={t.payerViewUrl} target="_blank" rel="noreferrer" className="font-medium text-[#0070ba] hover:underline">
                Open payer view in PayPal sandbox ↗
              </a>
            )}
          </footer>
        )}
      </aside>
    </div>
  );
}
