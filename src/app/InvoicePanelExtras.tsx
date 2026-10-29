"use client";

import { useState } from "react";
import { TimezoneInput } from "@/components/TimezoneInput";
import { useToast } from "@/components/Toast";
import { sendJson } from "@/lib/api";

const field = "w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0070ba]/40";

/** Client timezone + country (reminders go out in their business hours; country sets the tone). */
export function ClientLocation({
  client,
  onSaved,
}: {
  client: { id: string; timezone: string | null; country: string | null };
  onSaved: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [tz, setTz] = useState(client.timezone ?? "");
  const [country, setCountry] = useState(client.country ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await sendJson("PATCH", `/api/clients/${client.id}`, { timezone: tz.trim(), country: country.trim() });
      toast.success("Client updated", "Reminders will follow their business hours.");
      setEditing(false);
      onSaved();
    } catch (e) {
      toast.error("Couldn't save", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <p className="mb-4 flex flex-wrap items-center gap-x-2 text-xs text-slate-600">
        <span className="font-medium text-slate-800">Client location</span>
        {client.timezone ? <span className="font-mono">{client.timezone}</span> : <span className="text-amber-700">timezone unknown (reminders send immediately)</span>}
        {client.country && <span>· {client.country}</span>}
        <button onClick={() => setEditing(true)} className="font-medium text-[#0070ba] hover:underline">
          Edit
        </button>
      </p>
    );
  }
  return (
    <div className="mb-4 grid grid-cols-[1fr_5rem] gap-2 rounded-lg border border-slate-200 p-3">
      <TimezoneInput className={field} value={tz} onChange={(e) => setTz(e.target.value)} placeholder="e.g. Europe/London" aria-label="Client timezone" />
      <input className={field} value={country} onChange={(e) => setCountry(e.target.value)} placeholder="GB" maxLength={2} aria-label="Client country" />
      <div className="col-span-2 flex gap-2">
        <button onClick={save} disabled={busy} className="rounded-md bg-[#0070ba] px-3 py-1 text-xs font-semibold text-white disabled:opacity-60">
          {busy ? "Saving…" : "Save"}
        </button>
        <button onClick={() => setEditing(false)} disabled={busy} className="rounded-md px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** "Client replied": paste the client's reply; Claude reads it, code applies your limits. */
export function ClientReplyForm({ invoiceId, onDone }: { invoiceId: string; onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const r = await sendJson<{ message: string; warnings: string[]; category: string }>("POST", `/api/invoices/${invoiceId}/reply`, { text });
      toast.success(`Reply read as ${r.category.toLowerCase().replaceAll("_", " ")}`, [r.message, ...r.warnings].join(" "));
      setText("");
      setOpen(false);
      onDone();
    } catch (e) {
      toast.error("Couldn't process the reply", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mb-5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50">
        Client replied…
      </button>
    );
  }
  return (
    <div className="mb-5 space-y-2 rounded-lg border border-slate-200 p-3">
      <p className="text-sm font-medium">Paste the client&apos;s reply</p>
      <p className="text-xs text-slate-500">
        Claude reads it as data and classifies it (promise to pay, hardship, dispute, other). For hardship, <b>code</b> builds a payment plan within
        your Settings limits. Nothing is sent until you approve it in the agent inbox.
      </p>
      <textarea
        className={field}
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={5000}
        placeholder="Hi, cash flow is tight this month. Could we pay 30% now and the rest over two months?"
        disabled={busy}
      />
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy || !text.trim()} className="inline-flex items-center gap-2 rounded-md bg-[#0070ba] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
          {busy && <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
          {busy ? "Reading the reply…" : "Read reply"}
        </button>
        <button onClick={() => setOpen(false)} disabled={busy} className="rounded-md px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
          Cancel
        </button>
      </div>
    </div>
  );
}
