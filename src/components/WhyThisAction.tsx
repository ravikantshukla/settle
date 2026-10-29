import type { ActionRationale } from "@/lib/agent/rationale";
import { money, shortDate } from "@/lib/format";

const CONTACT_LABEL: Record<string, string> = { SEND_REMINDER: "Reminder", OFFER_PAYMENT_PLAN: "Payment-plan offer" };

/** "Why this action?": the facts the rules used when proposing (frozen on the AgentAction). */
export function WhyThisAction({ rationale: r, open = true }: { rationale: ActionRationale; open?: boolean }) {
  const c = r.evidence.currency;
  const row = "grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-0.5";
  const head = "text-xs font-semibold uppercase tracking-wide text-slate-500";
  return (
    <details open={open} className="group rounded-lg border border-slate-200 bg-slate-50/60 text-sm">
      <summary className="cursor-pointer select-none px-3 py-2 font-medium text-slate-900 marker:text-slate-400">
        Why this action?
        <span className="ml-2 text-xs font-normal text-slate-500">from the rules, as of {shortDate(r.evaluatedAt)} (demo clock)</span>
      </summary>
      <div className="space-y-2.5 border-t border-slate-200 px-3 py-2.5">
        <div className={row}>
          <span className={head}>Trigger</span>
          <span>{r.trigger}</span>
        </div>

        <div className={row}>
          <span className={head}>Evidence</span>
          <ul className="space-y-0.5 text-slate-700">
            <li>
              Paid so far: <b className="tabular-nums">{money(r.evidence.amountPaid, c)}</b> of {money(r.evidence.amount, c)}
              {r.evidence.payments.length > 0 && (
                <span className="text-slate-500">
                  {" "}
                  ({r.evidence.payments.map((p) => `${money(p.amount, c)} on ${shortDate(p.at)}`).join(", ")})
                </span>
              )}
            </li>
            {r.evidence.shares === undefined && (
              <li>
                {r.evidence.reminders.length === 0
                  ? "No reminders sent yet"
                  : `${r.evidence.reminders.length} already sent: ${r.evidence.reminders.map((m) => `${CONTACT_LABEL[m.type] ?? m.type} on ${shortDate(m.at)}`).join(", ")}`}
              </li>
            )}
            {r.evidence.risk && (
              <li>
                Risk score <b>{r.evidence.risk.score}</b>/100:{" "}
                <span className="text-slate-600">
                  {r.evidence.risk.factors.map((f) => `${f.text}${f.points ? ` (${f.points > 0 ? "+" : ""}${f.points})` : ""}`).join(" · ")}
                </span>
              </li>
            )}
            {r.evidence.shares?.map((s) => (
              <li key={s.name}>
                {s.name}: <b className="tabular-nums">{money(s.amount, c)}</b> <span className="text-slate-500">({s.basis})</span>
              </li>
            ))}
          </ul>
        </div>

        <div className={row}>
          <span className={head}>Action</span>
          <div className="space-y-0.5 text-slate-700">
            <p className="font-medium text-slate-900">{r.decision.path}</p>
            <p>{r.decision.rule}</p>
            {r.decision.details.map((d) => (
              <p key={d}>{d}</p>
            ))}
            <p className={r.wording.by === "claude" ? "text-violet-700" : "text-amber-700"}>{r.wording.label}</p>
          </div>
        </div>

        <div className={row}>
          <span className={head}>Safety</span>
          <span className="font-medium text-emerald-800">{r.safety}</span>
        </div>
      </div>
    </details>
  );
}
