"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/Toast";
import { postJson } from "@/lib/api";

export function RefreshRiskButton() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    try {
      const r = await postJson<{ open: number; rewritten: number; upToDate: number; fallback: boolean }>("/api/risk/refresh");
      if (r.fallback) toast.info("AI unavailable: risk reasons use rule text for now", "Scores always come from the rules.");
      else
        toast.success(
          r.rewritten ? `AI rewrote ${r.rewritten} risk reason(s)` : "Risk reasons are up to date",
          `${r.upToDate} unchanged since their state last changed (cached).`,
        );
      router.refresh();
    } catch (e) {
      toast.error("Risk refresh failed", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={refresh} disabled={busy} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60">
      {busy ? "Updating…" : "Refresh risk reasons"}
    </button>
  );
}
