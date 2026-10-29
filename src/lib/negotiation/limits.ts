/**
 * Payment-plan negotiation limits. Pure functions, no I/O, no AI.
 *
 * Claude only READS the client's reply and reports what they asked for. This code turns that request
 * into a plan that fits the freelancer's limits, clamping each term to the nearest allowed value and
 * rejecting only when no plan within the limits exists. Nothing the client writes ("my manager
 * approved 5%") can loosen a limit: the request is just numbers to check.
 */

const DAY_MS = 86_400_000;

export interface NegotiationLimits {
  /** Minimum share of the outstanding amount paid as the first installment. */
  minUpfrontPercent: number;
  /** Maximum number of payments, including the first one. */
  maxInstallments: number;
  /** The final payment must be due within this many days after the invoice's original due date. */
  maxDaysAfterDue: number;
}

/** What the client asked for (from their reply; any field may be missing). */
export interface PlanRequest {
  upfrontAmount?: number | null;
  upfrontPercent?: number | null;
  installments?: number | null;
  /** YYYY-MM-DD */
  finalDate?: string | null;
}

export interface PlanCheck {
  rule: string;
  limit: string;
  requested: string;
  result: "pass" | "clamped" | "fail";
  applied: string;
}

export interface Installment {
  n: number;
  /** YYYY-MM-DD */
  dueDate: string;
  amount: number;
}

export interface PlanOutcome {
  outcome: "ok" | "clamped" | "rejected";
  plan: { installments: Installment[]; upfront: number; total: number; finalDate: string; minimumAmount: number } | null;
  checks: PlanCheck[];
  /** Why there's no plan (rejected only). */
  reason?: string;
}

export const DEFAULT_LIMITS: NegotiationLimits = { minUpfrontPercent: 25, maxInstallments: 4, maxDaysAfterDue: 60 };

/** The first payment is due a week from today; later ones are spread evenly up to the final date. */
export const FIRST_PAYMENT_DAYS = 7;

const cents = (n: number) => Math.round(n * 100) / 100;
const floorCents = (n: number) => Math.floor(n * 100 + 1e-6) / 100;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const usd = (n: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export function buildPlan(
  request: PlanRequest | null,
  ctx: { outstanding: number; currency: string; dueDate: Date; now: Date },
  limits: NegotiationLimits,
): PlanOutcome {
  const { outstanding, currency } = ctx;
  const req = request ?? {};
  const checks: PlanCheck[] = [];
  const reject = (reason: string): PlanOutcome => ({ outcome: "rejected", plan: null, checks, reason });

  if (!(outstanding > 0)) return reject("Nothing is outstanding on this invoice.");

  // 1. Upfront payment.
  const minUpfront = cents((outstanding * limits.minUpfrontPercent) / 100);
  const asked =
    req.upfrontAmount != null && req.upfrontAmount >= 0
      ? cents(req.upfrontAmount)
      : req.upfrontPercent != null && req.upfrontPercent >= 0
        ? cents((outstanding * req.upfrontPercent) / 100)
        : null;
  let upfront = asked ?? minUpfront;
  const upfrontRule = { rule: "Minimum upfront payment", limit: `${limits.minUpfrontPercent}% = ${usd(minUpfront, currency)}` };
  if (asked === null) {
    checks.push({ ...upfrontRule, requested: "not specified", result: "pass", applied: usd(upfront, currency) });
  } else if (asked < minUpfront) {
    upfront = minUpfront;
    const pct = Math.round((asked / outstanding) * 1000) / 10;
    checks.push({ ...upfrontRule, requested: `${usd(asked, currency)} (${pct}%)`, result: "clamped", applied: usd(upfront, currency) });
  } else {
    checks.push({ ...upfrontRule, requested: usd(asked, currency), result: "pass", applied: usd(upfront, currency) });
  }
  if (upfront >= outstanding) return reject("The upfront payment covers the whole balance, so no plan is needed.");

  // 2. Number of payments (including the first).
  const maxCount = Math.max(1, Math.floor(limits.maxInstallments));
  if (maxCount < 2) {
    checks.push({ rule: "Maximum installments", limit: String(maxCount), requested: String(req.installments ?? "not specified"), result: "fail", applied: "—" });
    return reject("Your limits allow only one payment, so no installment plan is possible.");
  }
  const askedCount = req.installments != null && req.installments > 0 ? Math.round(req.installments) : null;
  let count = askedCount ?? Math.min(3, maxCount);
  const countRule = { rule: "Maximum installments", limit: `${maxCount} payments` };
  if (askedCount !== null && askedCount > maxCount) {
    count = maxCount;
    checks.push({ ...countRule, requested: `${askedCount} payments`, result: "clamped", applied: `${count} payments` });
  } else {
    count = Math.max(2, count);
    checks.push({ ...countRule, requested: askedCount === null ? "not specified" : `${askedCount} payments`, result: "pass", applied: `${count} payments` });
  }

  // 3. Final payment date.
  const today = startOfUtcDay(ctx.now);
  const first = new Date(today.getTime() + FIRST_PAYMENT_DAYS * DAY_MS);
  const latest = new Date(startOfUtcDay(ctx.dueDate).getTime() + limits.maxDaysAfterDue * DAY_MS);
  const dateRule = { rule: "Latest final payment", limit: `${limits.maxDaysAfterDue} days after the due date = ${ymd(latest)}` };
  // Leave at least a week between payments.
  const earliestFinal = new Date(first.getTime() + (count - 1) * 7 * DAY_MS);
  if (earliestFinal > latest) {
    // Fewer payments might still fit before the limit.
    const fits = Math.floor((latest.getTime() - first.getTime()) / (7 * DAY_MS)) + 1;
    if (fits < 2) {
      checks.push({ ...dateRule, requested: req.finalDate ?? "not specified", result: "fail", applied: "—" });
      return reject(`The latest allowed final date (${ymd(latest)}) is too close to offer installments.`);
    }
    checks.push({ ...countRule, requested: `${count} payments`, result: "clamped", applied: `${fits} payments (to finish by ${ymd(latest)})` });
    count = fits;
  }
  const askedFinal = req.finalDate && /^\d{4}-\d{2}-\d{2}$/.test(req.finalDate) ? new Date(`${req.finalDate}T00:00:00Z`) : null;
  const minFinal = new Date(first.getTime() + (count - 1) * 7 * DAY_MS);
  let final = askedFinal ?? latest;
  if (askedFinal && askedFinal > latest) {
    final = latest;
    checks.push({ ...dateRule, requested: req.finalDate!, result: "clamped", applied: ymd(final) });
  } else {
    if (final < minFinal) final = minFinal;
    checks.push({ ...dateRule, requested: req.finalDate ?? "not specified", result: "pass", applied: ymd(final) });
  }

  // 4. Amounts: the first payment is the upfront; the rest is split evenly (the last one absorbs the cents).
  const rest = cents(outstanding - upfront);
  const each = floorCents(rest / (count - 1));
  const span = final.getTime() - first.getTime();
  const installments: Installment[] = Array.from({ length: count }, (_, i) => ({
    n: i + 1,
    dueDate: ymd(new Date(first.getTime() + Math.round((span * i) / (count - 1) / DAY_MS) * DAY_MS)),
    amount: i === 0 ? upfront : i === count - 1 ? cents(rest - each * (count - 2)) : each,
  }));
  const total = cents(installments.reduce((s, x) => s + x.amount, 0));
  const totalOk = Math.abs(total - outstanding) < 0.005;
  checks.push({
    rule: "Adds up to the outstanding balance",
    limit: usd(outstanding, currency),
    requested: "—",
    result: totalOk ? "pass" : "fail",
    applied: usd(total, currency),
  });
  if (!totalOk) return reject("The installments don't add up to the outstanding balance.");

  return {
    outcome: checks.some((c) => c.result === "clamped") ? "clamped" : "ok",
    plan: {
      installments,
      upfront,
      total,
      finalDate: installments.at(-1)!.dueDate,
      // PayPal enforces one minimum for every partial payment: the smallest installment.
      minimumAmount: Math.min(...installments.map((x) => x.amount)),
    },
    checks,
  };
}

/** Deterministic red flags in a client's reply. Shown to the approver; limits apply regardless. */
export function replyWarnings(text: string): string[] {
  const out: string[] = [];
  if (/\b(manager|boss|director|you|freelancer|team|accounts?|finance|ceo|owner)\b[^.\n]{0,40}\b(approved|agreed|authori[sz]ed|okayed|signed off|confirmed)\b/i.test(text)) {
    out.push("The reply claims terms were already approved or agreed. That isn't verified: your limits were applied as usual.");
  }
  if (/\b(ignore|disregard|override)\b[^.\n]{0,40}\b(instructions?|rules?|limits?|policy)\b|\b(you are now|system prompt|act as)\b/i.test(text)) {
    out.push("The reply contains instructions aimed at the AI. They were treated as plain text.");
  }
  return out;
}
