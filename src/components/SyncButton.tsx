"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface SyncSummary {
  checked: number;
  updated: number;
  paymentsReceived: number;
  errors: Array<{ number: string; error: string }>;
}

export function SyncButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function sync() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      const s = data as SyncSummary;
      const parts = [`Checked ${s.checked}`, `updated ${s.updated}`];
      if (s.paymentsReceived) parts.push(`${s.paymentsReceived} new payment(s)`);
      if (s.errors.length) parts.push(`${s.errors.length} error(s): ${s.errors.map((e) => `${e.number}: ${e.error}`).join("; ")}`);
      setMessage({ tone: s.errors.length ? "error" : "ok", text: parts.join(", ") });
      startTransition(() => router.refresh());
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {message && (
        <span className={`text-xs ${message.tone === "ok" ? "text-slate-600" : "text-red-700"}`}>{message.text}</span>
      )}
      <button
        onClick={sync}
        disabled={loading}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
      >
        {loading ? "Syncing…" : "Sync with PayPal"}
      </button>
    </div>
  );
}
