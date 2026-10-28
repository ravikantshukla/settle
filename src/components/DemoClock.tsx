"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/Toast";
import { postJson } from "@/lib/api";
import { shortDate } from "@/lib/format";

/** DEMO_MODE toolbar: shows the simulated date and moves the demo clock. */
export function DemoClock({ now, offsetDays }: { now: string; offsetDays: number }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function move(body: { advanceDays: number } | { reset: true }, label: string) {
    setBusy(true);
    try {
      const r = await postJson<{ now: string; offsetDays: number }>("/api/demo/clock", body);
      toast.info(`Demo clock: ${shortDate(r.now)}`, `${label}. Run the agent to see what it proposes now.`);
      router.refresh();
    } catch (e) {
      toast.error("Couldn't move the clock", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const btn = "rounded px-1.5 py-0.5 font-medium text-violet-800 hover:bg-violet-100 disabled:opacity-50";
  return (
    <div className="border-b border-violet-200 bg-violet-50 text-xs">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2 gap-y-1 px-4 py-1.5">
        <span className="font-semibold text-violet-900">Demo clock</span>
        <span className="text-violet-900" aria-live="polite">
          {shortDate(now)}
          {offsetDays !== 0 && <span className="ml-1 text-violet-700">({offsetDays > 0 ? "+" : ""}{offsetDays} days)</span>}
        </span>
        <span className="mx-1 hidden h-3 w-px bg-violet-200 sm:inline-block" />
        <button className={btn} disabled={busy} onClick={() => move({ advanceDays: 1 }, "+1 day")}>+1 day</button>
        <button className={btn} disabled={busy} onClick={() => move({ advanceDays: 7 }, "+7 days")}>+7 days</button>
        <button className={btn} disabled={busy} onClick={() => move({ advanceDays: 30 }, "+30 days")}>+30 days</button>
        <button className={btn} disabled={busy || offsetDays === 0} onClick={() => move({ reset: true }, "Clock reset to today")}>Reset clock</button>
        <span className="ml-auto hidden text-violet-700 md:inline">Due dates, aging and the agent use this date. PayPal itself uses real time.</span>
      </div>
    </div>
  );
}
