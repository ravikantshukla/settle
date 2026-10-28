"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/Toast";
import { postJson } from "@/lib/api";

interface SyncSummary {
  checked: number;
  updated: number;
  paymentsReceived: number;
  errors: Array<{ number: string; error: string }>;
  payouts: { batches: number; itemsUpdated: number; errors: Array<{ batchId: string; error: string }> };
}

export function SyncButton() {
  const router = useRouter();
  const toast = useToast();
  const [loading, setLoading] = useState(false);

  async function sync() {
    setLoading(true);
    try {
      const s = await postJson<SyncSummary>("/api/sync");
      const parts = [`Checked ${s.checked} open invoice(s), ${s.updated} changed`];
      if (s.paymentsReceived) parts.push(`${s.paymentsReceived} new payment(s); the agent proposed payouts where splits apply`);
      if (s.payouts.batches) parts.push(`${s.payouts.itemsUpdated} payout item(s) refreshed`);
      const errors = [...s.errors.map((e) => `${e.number}: ${e.error}`), ...s.payouts.errors.map((e) => `${e.batchId}: ${e.error}`)];
      if (errors.length) toast.error(`Synced with ${errors.length} error(s)`, errors.join(" · "));
      else toast.success("Synced with PayPal", parts.join(". ") + ".");
      router.refresh();
    } catch (e) {
      toast.error("Sync failed", e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <button onClick={sync} disabled={loading} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60">
      {loading ? "Syncing…" : "Sync with PayPal"}
    </button>
  );
}
