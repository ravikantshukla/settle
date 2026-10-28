"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const KEY = "settle.onboarding.dismissed";

const STEPS = [
  { title: "Paste an agreement", body: "Load a sample on New invoice. Claude drafts the invoice and flags anything it's unsure of.", href: "/invoices/new" },
  { title: "Approve the invoice", body: "Review, edit if needed, then send it through PayPal Invoicing with one click." },
  { title: "Pay as the sandbox buyer", body: "Open the PayPal link, log in with your sandbox personal account, and pay all or part of it." },
  { title: "Let the agent work", body: "Sync with PayPal. The agent proposes subcontractor payouts and reminders for late invoices.", href: "/agent" },
  { title: "Approve", body: "Approve, edit or reject each proposal. Payouts go out as one PayPal Payouts batch.", href: "/payouts" },
];

export function OnboardingBanner() {
  // Start hidden to avoid a flash before localStorage is read.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(localStorage.getItem(KEY) !== "1");
    } catch {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(KEY, "1");
    } catch {}
  };

  return (
    <section className="relative overflow-hidden rounded-xl border border-[#0070ba]/20 bg-gradient-to-br from-sky-50 to-white p-5" aria-labelledby="onboarding-title">
      <button onClick={dismiss} className="absolute right-3 top-3 rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-white" aria-label="Dismiss the getting-started guide">
        ✕
      </button>
      <h2 id="onboarding-title" className="pr-8 font-semibold">The 3-minute tour</h2>
      <p className="mt-1 text-sm text-slate-600">
        Everything runs on the PayPal sandbox with test accounts. The sample invoices below (marked DEMO) are local only;
        approving their proposals is simulated.
      </p>
      <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {STEPS.map((s, i) => (
          <li key={s.title} className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#0070ba] text-[11px] font-bold text-white">{i + 1}</span>
              {s.href ? (
                <Link href={s.href} className="hover:text-[#0070ba] hover:underline">
                  {s.title}
                </Link>
              ) : (
                s.title
              )}
            </p>
            <p className="mt-1 text-xs text-slate-600">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
