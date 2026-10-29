"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/Toast";
import { postJson } from "@/lib/api";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/invoices/new", label: "New invoice" },
  { href: "/agent", label: "Agent" },
  { href: "/payouts", label: "Payouts" },
  { href: "/subcontractors", label: "Subcontractors" },
  { href: "/settings", label: "Settings" },
];

export function AppHeader({ demoMode, pendingActions }: { demoMode: boolean; pendingActions: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [resetting, setResetting] = useState(false);

  async function reset() {
    if (!window.confirm("Reset the demo? This cancels the open sandbox invoices, deletes ALL data in this app, resets the demo clock and creates fresh sandbox invoices for the sandbox buyer. It takes about 30 seconds.")) return;
    setResetting(true);
    try {
      await postJson("/api/demo/reset");
      try {
        localStorage.removeItem("settle.onboarding.dismissed");
      } catch {}
      toast.success("Demo reset", "Fresh invoices were created in the PayPal sandbox for your sandbox buyer.");
      router.push("/");
      router.refresh();
    } catch (e) {
      toast.error("Reset failed", e instanceof Error ? e.message : String(e));
    } finally {
      setResetting(false);
    }
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:flex-nowrap">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#0070ba] text-sm font-bold text-white">S</span>
          Settle
        </Link>
        <span
          className="ml-auto shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 sm:order-last sm:ml-0"
          title="All PayPal calls go to the PayPal sandbox. No real money moves."
        >
          PayPal sandbox
        </span>
        {demoMode && (
          <button
            onClick={reset}
            disabled={resetting}
            className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60 sm:order-last"
          >
            {resetting ? "Resetting (~30s)…" : "Reset demo"}
          </button>
        )}
        <nav className="-mx-4 order-last flex w-[calc(100%+2rem)] gap-1 overflow-x-auto px-4 text-sm sm:order-none sm:mx-0 sm:ml-4 sm:w-auto sm:flex-1 sm:px-0">
          {LINKS.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition ${
                  active ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                {l.label}
                {l.href === "/agent" && pendingActions > 0 && (
                  <span className="rounded-full bg-[#0070ba] px-1.5 text-[11px] font-semibold leading-5 text-white">{pendingActions}</span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
