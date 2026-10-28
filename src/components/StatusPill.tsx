const STYLE: Record<string, string> = {
  PAID: "bg-emerald-100 text-emerald-800",
  MARKED_AS_PAID: "bg-emerald-100 text-emerald-800",
  PARTIALLY_PAID: "bg-sky-100 text-sky-800",
  SENT: "bg-slate-100 text-slate-700",
  UNPAID: "bg-amber-100 text-amber-800",
  PAYMENT_PENDING: "bg-amber-100 text-amber-800",
  DRAFT: "bg-slate-100 text-slate-500",
  SCHEDULED: "bg-slate-100 text-slate-500",
  CANCELLED: "bg-slate-200 text-slate-600",
  REFUNDED: "bg-rose-100 text-rose-800",
  PARTIALLY_REFUNDED: "bg-rose-100 text-rose-800",
  MARKED_AS_REFUNDED: "bg-rose-100 text-rose-800",
  // Payout statuses
  SUCCESS: "bg-emerald-100 text-emerald-800",
  PENDING: "bg-amber-100 text-amber-800",
  UNCLAIMED: "bg-amber-100 text-amber-800",
  ONHOLD: "bg-amber-100 text-amber-800",
  FAILED: "bg-red-100 text-red-800",
  RETURNED: "bg-rose-100 text-rose-800",
  BLOCKED: "bg-red-100 text-red-800",
  REVERSED: "bg-rose-100 text-rose-800",
  NOT_STARTED: "bg-slate-100 text-slate-500",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STYLE[status] ?? "bg-slate-100 text-slate-700"}`}>
      {status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
    </span>
  );
}
