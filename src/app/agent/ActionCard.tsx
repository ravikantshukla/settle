"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/Toast";
import { WhyThisAction } from "@/components/WhyThisAction";
import type { ActionRationale } from "@/lib/agent/rationale";
import { postJson } from "@/lib/api";
import { ACTION_LABEL, ACTION_STYLE, money, relativeTime } from "@/lib/format";

export interface InboxAction {
  id: string;
  type: string;
  status: string;
  reasoning: string | null;
  rationale: ActionRationale | null;
  /** Client-facing actions: when an approved message goes out (client's business hours). */
  sendTiming: string | null;
  payload: Record<string, unknown>;
  proposedAt: string;
  isDemo: boolean;
  invoice: {
    number: string;
    currency: string;
    amount: number;
    outstanding: number;
    daysOverdue: number;
    client: string;
    project: string;
    payerViewUrl: string | null;
  } | null;
}

interface PayoutItem {
  name: string;
  email: string;
  routedFrom?: string;
  amount: number;
  basis: string;
}

const CLIENT_FACING = new Set(["SEND_REMINDER", "OFFER_PAYMENT_PLAN"]);

interface Negotiation {
  reply: { text: string; category: string; summary: string; warnings: string[] };
  outcome: "ok" | "clamped" | "rejected";
  checks: Array<{ rule: string; limit: string; requested: string; result: "pass" | "clamped" | "fail"; applied: string }>;
  plan: { installments: Array<{ n: number; dueDate: string; amount: number }>; total: number; minimumAmount: number } | null;
}

const CHECK_STYLE = {
  pass: "bg-emerald-100 text-emerald-800",
  clamped: "bg-amber-100 text-amber-800",
  fail: "bg-red-100 text-red-800",
} as const;
const CHECK_LABEL = { pass: "Pass", clamped: "Adjusted", fail: "Fail" } as const;

export function ActionCard({ action, now, compact = false }: { action: InboxAction; now: string; compact?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const p = action.payload;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<null | "approve" | "reject" | "send">(null);
  const [subject, setSubject] = useState(String(p.subject ?? ""));
  const [message, setMessage] = useState(String(p.message ?? ""));
  const [minimum, setMinimum] = useState(String(p.minimumAmount ?? ""));

  const inv = action.invoice;
  const currency = (p.currency as string) ?? inv?.currency ?? "USD";
  const items = (p.items as PayoutItem[] | undefined) ?? [];
  const inFlight = action.status === "APPROVED";
  const scheduled = action.status === "SCHEDULED";
  const negotiation = (p.negotiation as Negotiation | undefined) ?? null;
  const reply = negotiation?.reply ?? ((p.reply as Negotiation["reply"] | undefined) ?? null);

  async function approve() {
    setBusy("approve");
    try {
      const edits = editing
        ? {
            ...(subject !== p.subject && { subject }),
            ...(message !== p.message && { message }),
            ...(action.type === "OFFER_PAYMENT_PLAN" && Number(minimum) !== p.minimumAmount && { minimumAmount: Number(minimum) }),
          }
        : undefined;
      const r = await postJson<{ message: string; status: string }>(`/api/agent/actions/${action.id}/approve`, { edits });
      if (r.status === "SCHEDULED") toast.info("Approved and scheduled", r.message);
      else toast.success("Done via PayPal", r.message);
      router.refresh();
    } catch (e) {
      toast.error(`${ACTION_LABEL[action.type] ?? action.type} failed`, e instanceof Error ? e.message : String(e));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function sendNow() {
    setBusy("send");
    try {
      const r = await postJson<{ message: string }>(`/api/agent/actions/${action.id}/send-now`, {});
      toast.success("Sent via PayPal", r.message);
    } catch (e) {
      toast.error("Couldn't send", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  async function reject() {
    setBusy("reject");
    try {
      await postJson(`/api/agent/actions/${action.id}/reject`, {});
      if (scheduled) toast.info("Scheduled message cancelled", "Nothing was sent.");
      else toast.info("Proposal rejected", "The agent won't propose this again for a few days.");
      router.refresh();
    } catch (e) {
      toast.error("Couldn't reject", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const field = "w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0070ba]/40";

  return (
    <article className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${ACTION_STYLE[action.type] ?? "bg-slate-100"}`}>
          {ACTION_LABEL[action.type] ?? action.type}
        </span>
        {inv && (
          <span className="text-sm font-medium">
            {inv.number} · <span className="text-slate-600">{inv.client}</span>
          </span>
        )}
        {action.isDemo && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800">DEMO</span>}
        <span className="ml-auto text-xs text-slate-400">{relativeTime(action.proposedAt, now)}</span>
      </header>

      <div className="flex-1 space-y-3 px-4 py-3 text-sm">
        {inv && !compact && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            <span>{inv.project}</span>
            <span>Outstanding <b className="text-slate-900">{money(inv.outstanding, inv.currency)}</b> of {money(inv.amount, inv.currency)}</span>
            {inv.daysOverdue > 0 && action.type !== "PAYOUT_SUBCONTRACTORS" && <span className="font-medium text-red-700">{inv.daysOverdue} days overdue</span>}
          </div>
        )}

        {action.reasoning && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-700">
            <span className="mr-1 font-medium text-slate-900">{action.type === "PAYOUT_SUBCONTRACTORS" ? "Split:" : "Summary:"}</span>
            {action.reasoning}
          </p>
        )}

        {action.rationale && <WhyThisAction rationale={action.rationale} open={!compact} />}

        {reply && (
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Client&apos;s reply <span className="normal-case tracking-normal text-slate-400">(pasted by you; treated as untrusted data)</span>
            </p>
            <blockquote className="whitespace-pre-wrap rounded-lg border-l-4 border-slate-300 bg-slate-50 px-3 py-2 italic text-slate-700">{reply.text}</blockquote>
            <p className="text-xs text-slate-500">
              Read as <b className="text-slate-700">{reply.category.toLowerCase().replaceAll("_", " ")}</b>: {reply.summary}
            </p>
            {reply.warnings.map((w) => (
              <p key={w} className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">
                ⚠ {w}
              </p>
            ))}
          </div>
        )}

        {negotiation?.plan && (
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Payment plan</p>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {negotiation.plan.installments.map((x) => (
                  <tr key={x.n}>
                    <td className="py-1 text-slate-600">Payment {x.n}</td>
                    <td className="py-1 text-slate-600">by {x.dueDate}</td>
                    <td className="py-1 text-right font-semibold tabular-nums">{money(x.amount, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {negotiation && (
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Limits check <span className="normal-case tracking-normal text-slate-400">(by code, against your Settings)</span>
            </p>
            <ul className="space-y-1 text-xs">
              {negotiation.checks.map((c, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                  <span className={`rounded px-1.5 py-px font-semibold ${CHECK_STYLE[c.result]}`}>{CHECK_LABEL[c.result]}</span>
                  <span className="font-medium text-slate-800">{c.rule}</span>
                  <span className="text-slate-500">
                    limit {c.limit} · asked {c.requested}
                    {c.result !== "fail" && <> · plan {c.applied}</>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {CLIENT_FACING.has(action.type) && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{reply ? "Drafted response" : "Message to client"} (sent through PayPal)</p>
            {editing ? (
              <>
                <input className={field} value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
                <textarea className={field} rows={6} value={message} onChange={(e) => setMessage(e.target.value)} aria-label="Message" />
              </>
            ) : (
              <div className="rounded-lg border border-slate-200 px-3 py-2">
                <p className="font-medium">{subject}</p>
                <p className="mt-1 whitespace-pre-wrap text-slate-700">{message}</p>
              </div>
            )}
          </div>
        )}

        {action.type === "OFFER_PAYMENT_PLAN" && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-600">Allow partial payments, minimum</span>
            {editing ? (
              <input type="number" min="1" step="0.01" className={`${field} w-32`} value={minimum} onChange={(e) => setMinimum(e.target.value)} aria-label="Minimum installment" />
            ) : (
              <b>{money(Number(minimum), currency)}</b>
            )}
            <span className="text-slate-500">· ~{String(p.installments ?? 3)} installments</span>
          </div>
        )}

        {action.type === "ESCALATE" && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-900">{message}</p>
        )}

        {action.type === "PAYOUT_SUBCONTRACTORS" && (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {items.map((it) => (
                <tr key={it.email}>
                  <td className="py-1.5">
                    <div className="font-medium">{it.name}</div>
                    <div className="text-xs text-slate-500">{it.email} · {it.basis}</div>
                    {it.routedFrom && <div className="text-[11px] text-amber-700">demo: routed to sandbox account (original {it.routedFrom})</div>}
                  </td>
                  <td className="py-1.5 text-right font-semibold tabular-nums">{money(it.amount, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {action.sendTiming && (
        <p className={`border-t border-slate-100 px-4 py-2 text-xs ${scheduled ? "bg-sky-50 font-medium text-sky-900" : "text-slate-600"}`}>🕘 {action.sendTiming}</p>
      )}

      <footer className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
        {inFlight ? (
          <span className="text-sm text-slate-500">Executing…</span>
        ) : scheduled ? (
          <>
            <button
              onClick={sendNow}
              disabled={!!busy}
              className="rounded-lg bg-[#0070ba] px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-[#005ea6] disabled:opacity-60"
            >
              {busy === "send" ? "Sending…" : "Send now"}
            </button>
            <button onClick={reject} disabled={!!busy} className="ml-auto rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-60">
              {busy === "reject" ? "Cancelling…" : "Cancel"}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={approve}
              disabled={!!busy}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0070ba] px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-[#005ea6] disabled:opacity-60"
            >
              {busy === "approve" && <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
              {editing ? "Approve edited" : action.type === "PAYOUT_SUBCONTRACTORS" ? "Approve payout" : "Approve"}
            </button>
            {CLIENT_FACING.has(action.type) && !editing && (
              <button onClick={() => setEditing(true)} disabled={!!busy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60">
                Edit &amp; approve
              </button>
            )}
            {editing && (
              <button
                onClick={() => {
                  setEditing(false);
                  setSubject(String(p.subject ?? ""));
                  setMessage(String(p.message ?? ""));
                  setMinimum(String(p.minimumAmount ?? ""));
                }}
                disabled={!!busy}
                className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cancel edit
              </button>
            )}
            <button onClick={reject} disabled={!!busy} className="ml-auto rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-60">
              {busy === "reject" ? "Rejecting…" : "Reject"}
            </button>
          </>
        )}
      </footer>
    </article>
  );
}
