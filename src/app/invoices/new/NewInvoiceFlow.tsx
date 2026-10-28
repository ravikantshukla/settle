"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useToast } from "@/components/Toast";
import { SAMPLE_AGREEMENTS } from "@/lib/invoices/samples";
import { invoiceTotal, type Extraction } from "@/lib/invoices/schema";

type Step =
  | { kind: "input" }
  | { kind: "extracting" }
  | { kind: "review" }
  | { kind: "sending" }
  | { kind: "done"; number: string; payerViewUrl: string | null; paypalInvoiceId: string; recipientEmail: string; routed: boolean; extractedEmail: string };

// Form state keeps numbers as strings so inputs can be edited freely.
interface FormState {
  clientName: string;
  clientEmail: string;
  clientCompany: string;
  projectTitle: string;
  currency: string;
  dueDate: string;
  paymentTerms: string;
  allowPartial: boolean;
  minAmountDue: string;
  note: string;
  lineItems: Array<{ description: string; quantity: string; unitPrice: string }>;
  splits: Array<{ name: string; email: string; mode: "percentage" | "fixed"; value: string }>;
}

function toForm(x: Extraction): FormState {
  return {
    clientName: x.client.name,
    clientEmail: x.client.email ?? "",
    clientCompany: x.client.company ?? "",
    projectTitle: x.projectTitle,
    currency: x.currency,
    dueDate: x.dueDate ?? "",
    paymentTerms: x.paymentTerms ?? "",
    allowPartial: x.partialPayment.allowed,
    minAmountDue: x.partialPayment.minimumAmount?.toString() ?? "",
    note: "",
    lineItems: x.lineItems.map((li) => ({
      description: li.description,
      quantity: String(li.quantity),
      unitPrice: String(li.unitPrice),
    })),
    splits: x.subcontractorSplits.map((s) => ({
      name: s.name,
      email: s.email ?? "",
      mode: s.percentage !== null ? "percentage" : "fixed",
      value: String(s.percentage ?? s.fixedAmount ?? ""),
    })),
  };
}

const optNum = (s: string) => (s.trim() === "" ? undefined : Number(s));
const optStr = (s: string) => (s.trim() === "" ? undefined : s.trim());

/** Map extraction paths onto form field paths so uncertain fields can be highlighted. */
const FIELD_ALIASES: Record<string, string> = {
  "partialPayment.minimumAmount": "minAmountDue",
  "partialPayment.allowed": "allowPartial",
  "partialPayment": "minAmountDue",
};
function normalizePath(p: string): string {
  const dotted = p.replace(/\[(\d+)\]/g, ".$1").replace(/^\./, "");
  return (FIELD_ALIASES[dotted] ?? dotted)
    .replace(/^subcontractorSplits/, "splits")
    .replace(/^(splits\.\d+)\.(percentage|fixedAmount)$/, "$1.value");
}

type ExtractionView = Extraction & { model: string; warnings?: string[] };

const BLANK: ExtractionView = {
  client: { name: "", email: null, company: null },
  projectTitle: "",
  currency: "USD",
  lineItems: [{ description: "", quantity: 1, unitPrice: 0 }],
  dueDate: null,
  paymentTerms: null,
  partialPayment: { allowed: false, minimumAmount: null },
  subcontractorSplits: [],
  confidence: 0,
  uncertainFields: [],
  notes: null,
  model: "manual",
  warnings: [],
};

export function NewInvoiceFlow({ demo }: { demo: { buyerEmail: string } | null }) {
  const [step, setStep] = useState<Step>({ kind: "input" });
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [extraction, setExtraction] = useState<ExtractionView | null>(null);
  const [offerManual, setOfferManual] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [requestId, setRequestId] = useState("");
  const toast = useToast();

  const uncertain = useMemo(() => (extraction?.uncertainFields ?? []).map(normalizePath), [extraction]);
  const isUncertain = (path: string) =>
    uncertain.some((u) => path === u || path.startsWith(`${u}.`) || u.startsWith(`${path}.`));

  async function extract() {
    setError(null);
    setStep({ kind: "extracting" });
    try {
      const res = await fetch("/api/invoices/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOfferManual(data.fallback === "manual");
        throw new Error(data.error ?? "Extraction failed");
      }
      setOfferManual(false);
      setExtraction(data.extraction);
      setForm(toForm(data.extraction));
      setFieldErrors({});
      setRequestId(crypto.randomUUID()); // one id per approval attempt => PayPal idempotency
      setStep({ kind: "review" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast.error("Couldn't draft the invoice", e instanceof Error ? e.message : String(e));
      setStep({ kind: "input" });
    }
  }

  async function approveAndSend() {
    if (!form) return;
    setError(null);
    setFieldErrors({});
    setStep({ kind: "sending" });
    const body = {
      requestId,
      sourceText: text,
      client: { name: form.clientName, email: form.clientEmail, company: optStr(form.clientCompany) },
      projectTitle: form.projectTitle,
      currency: form.currency,
      dueDate: optStr(form.dueDate),
      paymentTerms: optStr(form.paymentTerms),
      allowPartial: form.allowPartial,
      minAmountDue: form.allowPartial ? optNum(form.minAmountDue) : undefined,
      note: optStr(form.note),
      lineItems: form.lineItems.map((li) => ({
        description: li.description,
        quantity: Number(li.quantity),
        unitPrice: Number(li.unitPrice),
      })),
      splits: form.splits.map((s) => ({
        name: s.name,
        email: s.email,
        percentage: s.mode === "percentage" ? optNum(s.value) : undefined,
        fixedAmount: s.mode === "fixed" ? optNum(s.value) : undefined,
      })),
    };
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.fieldErrors) {
          setFieldErrors(
            Object.fromEntries(
              (data.fieldErrors as Array<{ path: string; message: string }>).map((f) => [
                f.path.replace(/^splits\.(\d+)\.(percentage|fixedAmount)$/, "splits.$1.value"),
                f.message,
              ]),
            ),
          );
        }
        // A failure after the PayPal draft exists needs a fresh request id on retry.
        if (data.stage === "paypal_send") setRequestId(crypto.randomUUID());
        throw new Error(data.error ?? "Sending failed");
      }
      toast.success(`Invoice ${data.number} sent via PayPal`, "The client got PayPal's invoice email.");
      setStep({
        kind: "done",
        number: data.number,
        payerViewUrl: data.payerViewUrl,
        paypalInvoiceId: data.paypalInvoiceId,
        recipientEmail: data.recipientEmail,
        routed: data.routed,
        extractedEmail: form.clientEmail,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast.error("Invoice not sent", e instanceof Error ? e.message : String(e));
      setStep({ kind: "review" });
    }
  }

  function reset() {
    setStep({ kind: "input" });
    setExtraction(null);
    setForm(null);
    setError(null);
    setFieldErrors({});
  }

  if (step.kind === "done") {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
        <h2 className="text-lg font-semibold text-emerald-900">Invoice {step.number} sent via PayPal</h2>
        <p className="mt-1 text-sm text-emerald-800">PayPal emailed the client. To try the full flow, open the invoice, pay it while logged in as your sandbox personal account, then click Sync with PayPal on the dashboard.</p>
        <dl className="mt-4 space-y-1 text-sm">
          <div>
            <dt className="inline text-slate-600">PayPal invoice ID: </dt>
            <dd className="inline font-mono">{step.paypalInvoiceId}</dd>
          </div>
          <div>
            <dt className="inline text-slate-600">Sent to: </dt>
            <dd className="inline">
              {step.recipientEmail}
              {step.routed && (
                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                  demo: routed to sandbox buyer (extracted: {step.extractedEmail})
                </span>
              )}
            </dd>
          </div>
        </dl>
        <div className="mt-5 flex flex-wrap gap-3">
          {step.payerViewUrl && (
            <a
              href={step.payerViewUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-[#0070ba] px-4 py-2 text-sm font-medium text-white hover:bg-[#005ea6]"
            >
              Open PayPal invoice ↗
            </a>
          )}
          <Link href="/" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50">
            Go to dashboard
          </Link>
          <button onClick={reset} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-white">
            Create another
          </button>
        </div>
      </div>
    );
  }

  const busy = step.kind === "extracting" || step.kind === "sending";

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {(step.kind === "input" || step.kind === "extracting") && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-700">Agreement or email thread</span>
            <span className="ml-auto text-xs text-slate-500">Load sample:</span>
            {SAMPLE_AGREEMENTS.map((s) => (
              <button
                key={s.label}
                type="button"
                disabled={busy}
                onClick={() => setText(s.text)}
                className="rounded-md border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
              >
                {s.label}
              </button>
            ))}
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            rows={16}
            placeholder="Paste the agreement, SOW, or email thread here…"
            className="w-full rounded-lg border border-slate-300 p-3 font-mono text-sm focus:border-[#0070ba] focus:outline-none disabled:bg-slate-50"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={extract}
              disabled={busy || !text.trim()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {step.kind === "extracting" ? "Reading agreement…" : "Draft invoice with AI"}
            </button>
            {step.kind === "extracting" && <Spinner label="Claude is extracting client, line items and terms" />}
            {offerManual && step.kind === "input" && (
              <button
                type="button"
                onClick={() => {
                  setExtraction(BLANK);
                  setForm(toForm(BLANK));
                  setFieldErrors({});
                  setError(null);
                  setRequestId(crypto.randomUUID());
                  setStep({ kind: "review" });
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
              >
                Fill in manually
              </button>
            )}
          </div>
        </section>
      )}

      {(step.kind === "review" || step.kind === "sending") && form && extraction && (
        <ReviewForm
          form={form}
          setForm={setForm}
          extraction={extraction}
          isUncertain={isUncertain}
          fieldErrors={fieldErrors}
          busy={busy}
          sending={step.kind === "sending"}
          onBack={reset}
          onSubmit={approveAndSend}
          demo={demo}
        />
      )}
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-2 text-sm text-slate-600">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
      {label}
    </span>
  );
}

interface ReviewProps {
  form: FormState;
  setForm: (f: FormState) => void;
  extraction: ExtractionView;
  isUncertain: (path: string) => boolean;
  fieldErrors: Record<string, string>;
  busy: boolean;
  sending: boolean;
  onBack: () => void;
  onSubmit: () => void;
  demo: { buyerEmail: string } | null;
}

function ReviewForm({ form, setForm, extraction, isUncertain, fieldErrors, busy, sending, onBack, onSubmit, demo }: ReviewProps) {
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm({ ...form, [key]: value });
  const total = invoiceTotal(form.lineItems.map((li) => ({ quantity: Number(li.quantity) || 0, unitPrice: Number(li.unitPrice) || 0 })));
  const money = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: /^[A-Z]{3}$/.test(form.currency) ? form.currency : "USD" }).format(n);
  const pct = Math.round(extraction.confidence * 100);

  const inputCls = (path: string) =>
    `w-full rounded-md border px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0070ba]/40 disabled:bg-slate-50 ${
      fieldErrors[path]
        ? "border-red-400 bg-red-50"
        : isUncertain(path)
          ? "border-amber-400 bg-amber-50"
          : "border-slate-300 bg-white"
    }`;

  const field = (label: string, path: string, el: React.ReactNode) => (
    <label className="block space-y-1">
      <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
        {label}
        {isUncertain(path) && <span className="rounded bg-amber-200 px-1 text-[10px] font-semibold text-amber-900">CHECK</span>}
      </span>
      {el}
      {fieldErrors[path] && <span className="text-xs text-red-700">{fieldErrors[path]}</span>}
    </label>
  );

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {!!extraction.warnings?.length && (
        <section role="alert" className="space-y-1 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-semibold">Check this draft carefully</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {extraction.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      {extraction.model === "manual" ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          Manual entry: the AI wasn&apos;t available, so fill in the invoice yourself. Everything else works the same.
        </section>
      ) : (
      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            pct >= 80 ? "bg-emerald-100 text-emerald-800" : pct >= 50 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"
          }`}
        >
          AI confidence {pct}%
        </span>
        <span className="text-slate-600">
          {extraction.uncertainFields.length
            ? `${extraction.uncertainFields.length} field(s) need a check. They're highlighted in amber.`
            : "No uncertain fields flagged."}
        </span>
        <span className="ml-auto text-xs text-slate-400">{extraction.model}</span>
        {extraction.notes && <p className="w-full rounded-md bg-slate-50 p-3 text-slate-700">{extraction.notes}</p>}
      </section>
      )}

      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-3">
        <h2 className="text-sm font-semibold sm:col-span-3">Client &amp; project</h2>
        {field("Client name", "client.name", <input className={inputCls("client.name")} value={form.clientName} onChange={(e) => set("clientName", e.target.value)} disabled={busy} />)}
        {field("Client email", "client.email", <input type="email" className={inputCls("client.email")} value={form.clientEmail} onChange={(e) => set("clientEmail", e.target.value)} disabled={busy} placeholder="billing@client.com" />)}
        {field("Company", "client.company", <input className={inputCls("client.company")} value={form.clientCompany} onChange={(e) => set("clientCompany", e.target.value)} disabled={busy} />)}
        <p className="-mt-2 text-xs text-slate-500 sm:col-span-3">
          {demo ? (
            <>
              <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">demo: routed to sandbox buyer</span>{" "}
              PayPal will send this invoice to <b>{demo.buyerEmail || "SANDBOX_BUYER_EMAIL (not set!)"}</b>; the client email above is kept on the record.
            </>
          ) : (
            <>PayPal sends the invoice to the client email above.</>
          )}
        </p>
        {field("Project title", "projectTitle", <input className={inputCls("projectTitle")} value={form.projectTitle} onChange={(e) => set("projectTitle", e.target.value)} disabled={busy} />)}
        {field("Due date", "dueDate", <input type="date" className={inputCls("dueDate")} value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} disabled={busy} />)}
        {field("Payment terms", "paymentTerms", <input className={inputCls("paymentTerms")} value={form.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} disabled={busy} />)}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">Line items</h2>
          <div className="ml-auto w-24">
            {field("Currency", "currency", <input className={inputCls("currency")} value={form.currency} maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase())} disabled={busy} />)}
          </div>
        </div>
        <div className="-mx-5 overflow-x-auto px-5">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="pb-1 font-medium">Description</th>
              <th className="w-24 pb-1 font-medium">Qty</th>
              <th className="w-32 pb-1 font-medium">Unit price</th>
              <th className="w-28 pb-1 text-right font-medium">Amount</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {form.lineItems.map((li, i) => {
              const update = (patch: Partial<typeof li>) =>
                set("lineItems", form.lineItems.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <tr key={i} className="align-top">
                  <td className="py-1 pr-2">
                    <input className={inputCls(`lineItems.${i}.description`)} value={li.description} onChange={(e) => update({ description: e.target.value })} disabled={busy} />
                  </td>
                  <td className="py-1 pr-2">
                    <input type="number" step="any" min="0" className={inputCls(`lineItems.${i}.quantity`)} value={li.quantity} onChange={(e) => update({ quantity: e.target.value })} disabled={busy} />
                  </td>
                  <td className="py-1 pr-2">
                    <input type="number" step="0.01" min="0" className={inputCls(`lineItems.${i}.unitPrice`)} value={li.unitPrice} onChange={(e) => update({ unitPrice: e.target.value })} disabled={busy} />
                  </td>
                  <td className="py-2 text-right tabular-nums">{money((Number(li.quantity) || 0) * (Number(li.unitPrice) || 0))}</td>
                  <td className="py-1 text-right">
                    <button
                      type="button"
                      aria-label="Remove line item"
                      disabled={busy || form.lineItems.length === 1}
                      onClick={() => set("lineItems", form.lineItems.filter((_, j) => j !== i))}
                      className="rounded px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="pt-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => set("lineItems", [...form.lineItems, { description: "", quantity: "1", unitPrice: "0" }])}
                  className="text-xs font-medium text-[#0070ba] hover:underline"
                >
                  + Add line item
                </button>
              </td>
              <td className="pt-2 text-right font-semibold tabular-nums">{money(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
        </div>
        {fieldErrors.lineItems && <p className="text-xs text-red-700">{fieldErrors.lineItems}</p>}
      </section>

      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-3">
        <h2 className="text-sm font-semibold sm:col-span-3">Payment options</h2>
        <label className="flex items-center gap-2 text-sm sm:col-span-1">
          <input type="checkbox" checked={form.allowPartial} onChange={(e) => set("allowPartial", e.target.checked)} disabled={busy} />
          Allow partial payments
          {isUncertain("allowPartial") && <span className="rounded bg-amber-200 px-1 text-[10px] font-semibold text-amber-900">CHECK</span>}
        </label>
        {form.allowPartial &&
          field("Minimum payment", "minAmountDue", <input type="number" step="0.01" min="0" className={inputCls("minAmountDue")} value={form.minAmountDue} onChange={(e) => set("minAmountDue", e.target.value)} disabled={busy} placeholder="optional" />)}
        <div className="sm:col-span-3">
          {field("Note to client (optional)", "note", <textarea rows={2} className={inputCls("note")} value={form.note} onChange={(e) => set("note", e.target.value)} disabled={busy} />)}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <div>
          <h2 className="text-sm font-semibold">Subcontractor splits</h2>
          <p className="text-xs text-slate-500">Paid out of this invoice via PayPal Payouts after the client pays, and only once you approve.</p>
        </div>
        {form.splits.length === 0 && <p className="text-sm text-slate-500">None.</p>}
        {fieldErrors.splits && <p className="text-xs text-red-700">{fieldErrors.splits}</p>}
        {form.splits.map((s, i) => {
          const update = (patch: Partial<typeof s>) => set("splits", form.splits.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <div key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_1.4fr_8rem_7rem_2rem]">
              {field("Name", `splits.${i}.name`, <input className={inputCls(`splits.${i}.name`)} value={s.name} onChange={(e) => update({ name: e.target.value })} disabled={busy} />)}
              {field("PayPal email", `splits.${i}.email`, <input type="email" className={inputCls(`splits.${i}.email`)} value={s.email} onChange={(e) => update({ email: e.target.value })} disabled={busy} />)}
              {field("Type", `splits.${i}.mode`, (
                <select className={inputCls(`splits.${i}.mode`)} value={s.mode} onChange={(e) => update({ mode: e.target.value as "percentage" | "fixed" })} disabled={busy}>
                  <option value="percentage">% of total</option>
                  <option value="fixed">Fixed amount</option>
                </select>
              ))}
              {field(s.mode === "percentage" ? "Percent" : "Amount", `splits.${i}.value`, <input type="number" step="any" min="0" className={inputCls(`splits.${i}.value`)} value={s.value} onChange={(e) => update({ value: e.target.value })} disabled={busy} />)}
              <button
                type="button"
                aria-label="Remove split"
                disabled={busy}
                onClick={() => set("splits", form.splits.filter((_, j) => j !== i))}
                className="mb-1 rounded px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ×
              </button>
              {fieldErrors[`splits.${i}`] && <p className="text-xs text-red-700 sm:col-span-5">{fieldErrors[`splits.${i}`]}</p>}
            </div>
          );
        })}
        <button
          type="button"
          disabled={busy}
          onClick={() => set("splits", [...form.splits, { name: "", email: "", mode: "percentage", value: "" }])}
          className="text-xs font-medium text-[#0070ba] hover:underline"
        >
          + Add subcontractor
        </button>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-[#0070ba] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#005ea6] disabled:opacity-60"
        >
          {sending ? "Sending via PayPal…" : `Approve & send ${money(total)} via PayPal`}
        </button>
        {sending && <Spinner label="Creating the PayPal draft and sending it" />}
        <button type="button" onClick={onBack} disabled={busy} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-white disabled:opacity-50">
          Start over
        </button>
      </div>
    </form>
  );
}
