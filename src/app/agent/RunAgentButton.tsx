"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/Toast";
import { postJson } from "@/lib/api";

interface RunSummary {
  evaluated: number;
  proposed: number;
  errors: number;
}

export function RunAgentButton() {
  const router = useRouter();
  const toast = useToast();
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    try {
      const r = await postJson<RunSummary>("/api/agent/run");
      const title = r.proposed ? `Agent proposed ${r.proposed} action(s)` : "Agent run complete: nothing new to propose";
      const detail = `Checked ${r.evaluated} open invoice(s).${r.errors ? ` ${r.errors} failed — see Activity.` : ""}`;
      if (r.errors) toast.error(title, detail);
      else toast.success(title, detail);
      router.refresh();
    } catch (e) {
      toast.error("Agent run failed", e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <button
      onClick={run}
      disabled={running}
      className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
    >
      {running && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
      {running ? "Agent is reviewing invoices…" : "Run agent now"}
    </button>
  );
}
