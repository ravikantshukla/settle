/** Client-safe display formatting. */

export function money(amount: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function shortDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** `now` is the (demo) clock time from the server, as an ISO string or epoch ms. */
export function relativeTime(d: Date | string, now: Date | string | number): string {
  const diff = (new Date(d).getTime() - new Date(now).getTime()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

export const ACTION_LABEL: Record<string, string> = {
  SEND_INVOICE: "Send invoice",
  SEND_REMINDER: "Reminder",
  OFFER_PAYMENT_PLAN: "Payment plan",
  PAYOUT_SUBCONTRACTORS: "Subcontractor payout",
  ESCALATE: "Escalate",
};

export const ACTION_STYLE: Record<string, string> = {
  SEND_INVOICE: "bg-slate-100 text-slate-700",
  SEND_REMINDER: "bg-sky-100 text-sky-800",
  OFFER_PAYMENT_PLAN: "bg-violet-100 text-violet-800",
  PAYOUT_SUBCONTRACTORS: "bg-emerald-100 text-emerald-800",
  ESCALATE: "bg-rose-100 text-rose-800",
};
