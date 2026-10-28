import { ACTION_LABEL, relativeTime } from "@/lib/format";

export type TimelineItem =
  | {
      kind: "run";
      id: string;
      at: string;
      trigger: string;
      decision: string;
      model: string | null;
      observations: Array<Record<string, unknown>>;
    }
  | {
      kind: "action";
      id: string;
      at: string;
      type: string;
      status: string;
      invoiceNumber: string | null;
      result: Record<string, unknown> | null;
      subject: string | null;
    };

const STATUS_DOT: Record<string, string> = {
  EXECUTED: "bg-emerald-500",
  FAILED: "bg-red-500",
  REJECTED: "bg-slate-400",
};

const TRIGGER_LABEL: Record<string, string> = {
  manual: "Manual run",
  scheduled: "Scheduled run",
  payment_received: "Payment received",
};

export function Timeline({ items, now }: { items: TimelineItem[]; now: string }) {
  if (!items.length) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-8 text-center text-sm text-slate-500">
        No activity yet. Agent runs and approved actions will show up here.
      </div>
    );
  }
  return (
    <ol className="relative space-y-3 border-l border-slate-200 pl-5">
      {items.map((item) => (
        <li key={`${item.kind}-${item.id}`} className="relative">
          <span
            className={`absolute -left-[26px] top-2 h-3 w-3 rounded-full ring-4 ring-slate-50 ${
              item.kind === "run" ? "bg-slate-900" : (STATUS_DOT[item.status] ?? "bg-slate-400")
            }`}
          />
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
            {item.kind === "run" ? <RunEntry item={item} now={now} /> : <ActionEntry item={item} now={now} />}
          </div>
        </li>
      ))}
    </ol>
  );
}

function RunEntry({ item, now }: { item: Extract<TimelineItem, { kind: "run" }>; now: string }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{TRIGGER_LABEL[item.trigger] ?? item.trigger}</span>
        <span className="text-xs text-slate-400">{relativeTime(item.at, now)}</span>
        {item.model && <span className="ml-auto text-xs text-slate-400">{item.model}</span>}
      </div>
      <p className="mt-1 text-slate-700">{item.decision}</p>
      {item.observations.length > 0 && typeof item.observations[0]?.invoice === "string" && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-800">
            What the agent looked at ({item.observations.length})
          </summary>
          <ul className="mt-2 space-y-1 text-xs">
            {item.observations.map((o, i) => (
              <li key={i} className="flex gap-2">
                <span className="w-24 shrink-0 font-mono text-slate-500">{String(o.invoice)}</span>
                <span className={o.error ? "text-red-700" : "text-slate-700"}>
                  {String(o.verdict)}
                  {o.error ? ` — ${String(o.error)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function ActionEntry({ item, now }: { item: Extract<TimelineItem, { kind: "action" }>; now: string }) {
  const r = item.result ?? {};
  const verb = item.status === "EXECUTED" ? "Executed" : item.status === "FAILED" ? "Failed" : "Rejected";
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">
          {verb}: {ACTION_LABEL[item.type] ?? item.type}
          {item.invoiceNumber && <span className="font-normal text-slate-600"> · {item.invoiceNumber}</span>}
        </span>
        {r.editedByUser === true && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">EDITED</span>}
        <span className="text-xs text-slate-400">{relativeTime(item.at, now)}</span>
      </div>
      {item.subject && <p className="mt-1 text-slate-600">“{item.subject}”</p>}
      {typeof r.payout_batch_id === "string" && (
        <p className="mt-1 text-xs text-slate-500">
          Payout batch <span className="font-mono">{r.payout_batch_id}</span>
          {typeof r.batch_status === "string" && ` · ${r.batch_status}`}
        </p>
      )}
      {typeof r.error === "string" && <p className="mt-1 text-xs text-red-700">{r.error}</p>}
      {r.superseded === true && <p className="mt-1 text-xs text-slate-500">Superseded by a newer proposal.</p>}
    </>
  );
}
