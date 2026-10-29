"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TimezoneInput } from "@/components/TimezoneInput";
import { useToast } from "@/components/Toast";
import { sendJson } from "@/lib/api";
import { FreelancerSettingsSchema, type FreelancerSettings } from "@/lib/settings/schema";

type Form = Record<keyof FreelancerSettings, string>;

const toForm = (s: FreelancerSettings): Form => ({
  name: s.name,
  city: s.city,
  timezone: s.timezone,
  minUpfrontPercent: String(s.minUpfrontPercent),
  maxInstallments: String(s.maxInstallments),
  maxDaysAfterDue: String(s.maxDaysAfterDue),
});

export function SettingsForm({ initial }: { initial: FreelancerSettings }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<Form>(toForm(initial));
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = FreelancerSettingsSchema.safeParse({
      ...form,
      minUpfrontPercent: Number(form.minUpfrontPercent),
      maxInstallments: Number(form.maxInstallments),
      maxDaysAfterDue: Number(form.maxDaysAfterDue),
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message])));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const saved = await sendJson<FreelancerSettings>("PUT", "/api/settings", parsed.data);
      setForm(toForm(saved));
      toast.success("Settings saved", "New payment plans use these limits.");
      router.refresh();
    } catch (err) {
      toast.error("Couldn't save", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const input = (k: keyof Form) =>
    `w-full rounded-md border px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0070ba]/40 ${errors[k] ? "border-red-400" : "border-slate-300"}`;
  const field = (k: keyof Form, label: string, control: React.ReactNode, hint?: string) => (
    <label className="block space-y-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      {control}
      {errors[k] ? <span className="block text-xs text-red-600">{errors[k]}</span> : hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );

  return (
    <form onSubmit={save} className="space-y-6">
      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-3">
        <h2 className="text-sm font-semibold sm:col-span-3">You</h2>
        {field("name", "Your name", <input className={input("name")} value={form.name} onChange={(e) => set("name", e.target.value)} />, "Used to sign messages to clients.")}
        {field("city", "City", <input className={input("city")} value={form.city} onChange={(e) => set("city", e.target.value)} />)}
        {field(
          "timezone",
          "Your timezone",
          <TimezoneInput className={input("timezone")} value={form.timezone} onChange={(e) => set("timezone", e.target.value)} />,
          "Send times are shown in your time too, e.g. “10:00 AM client time (8:30 PM IST)”.",
        )}
      </section>

      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <h2 className="text-sm font-semibold">Negotiation limits</h2>
          <p className="mt-1 text-xs text-slate-500">
            Applied by code to every payment plan the agent proposes from a client&apos;s reply. Requests outside them are adjusted to the
            nearest allowed plan, or handed to you if none fits. What a client writes (&ldquo;my manager approved 5%&rdquo;) can&apos;t change them.
          </p>
        </div>
        {field(
          "minUpfrontPercent",
          "Minimum upfront payment (%)",
          <input type="number" min={0} max={100} step="1" className={input("minUpfrontPercent")} value={form.minUpfrontPercent} onChange={(e) => set("minUpfrontPercent", e.target.value)} />,
          "Share of the balance due as the first payment.",
        )}
        {field(
          "maxInstallments",
          "Maximum installments",
          <input type="number" min={2} max={12} step="1" className={input("maxInstallments")} value={form.maxInstallments} onChange={(e) => set("maxInstallments", e.target.value)} />,
          "Total number of payments, including the first.",
        )}
        {field(
          "maxDaysAfterDue",
          "Latest final payment (days after due date)",
          <input type="number" min={7} max={365} step="1" className={input("maxDaysAfterDue")} value={form.maxDaysAfterDue} onChange={(e) => set("maxDaysAfterDue", e.target.value)} />,
          "The last installment must fall within this many days of the invoice's original due date.",
        )}
      </section>

      <button type="submit" disabled={busy} className="rounded-lg bg-[#0070ba] px-4 py-2 text-sm font-semibold text-white hover:bg-[#005ea6] disabled:opacity-60">
        {busy ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
