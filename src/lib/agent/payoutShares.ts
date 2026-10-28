/**
 * Subcontractor share math. Pure functions, no I/O.
 *
 * A split's full share is a percentage of the invoice total or a fixed amount. When the client has
 * paid only part of the invoice, each subcontractor has earned the same fraction of their share.
 * Amounts are floored to cents so the sum of installment payouts never exceeds the full share;
 * the last payment releases the remainder exactly.
 */

export interface SplitInput {
  id: string;
  percentage: number | null;
  fixedAmount: number | null;
  /** Already paid out or in flight for this split. */
  alreadyPaidOut: number;
}

export interface ShareDue {
  splitId: string;
  fullShare: number;
  earned: number;
  due: number;
  basis: string;
}

const floorCents = (n: number) => Math.floor(n * 100 + 1e-6) / 100;
const roundCents = (n: number) => Math.round(n * 100) / 100;

export function fullShare(split: Pick<SplitInput, "percentage" | "fixedAmount">, invoiceAmount: number): number {
  if (split.percentage !== null && split.percentage !== undefined) return roundCents((invoiceAmount * split.percentage) / 100);
  return roundCents(split.fixedAmount ?? 0);
}

export function computeSharesDue(invoiceAmount: number, amountPaid: number, splits: SplitInput[]): ShareDue[] {
  if (invoiceAmount <= 0) return [];
  const fraction = Math.min(1, Math.max(0, amountPaid / invoiceAmount));

  return splits
    .map((s) => {
      const full = fullShare(s, invoiceAmount);
      const earned = fraction >= 1 ? full : floorCents(full * fraction);
      const due = roundCents(Math.max(0, earned - s.alreadyPaidOut));
      const basis =
        s.percentage !== null ? `${s.percentage}% of ${invoiceAmount.toFixed(2)}` : `fixed ${full.toFixed(2)}`;
      return {
        splitId: s.id,
        fullShare: full,
        earned,
        due,
        basis: fraction < 1 ? `${basis}, ${(fraction * 100).toFixed(1)}% paid so far` : basis,
      };
    })
    .filter((s) => s.due > 0);
}

/** Total committed by a set of splits against an invoice total. */
export function totalCommitted(invoiceAmount: number, splits: Array<Pick<SplitInput, "percentage" | "fixedAmount">>): number {
  return roundCents(splits.reduce((sum, s) => sum + fullShare(s, invoiceAmount), 0));
}

export function validateSplits(
  invoiceAmount: number,
  splits: Array<Pick<SplitInput, "percentage" | "fixedAmount">>,
): string | null {
  for (const s of splits) {
    const hasPct = s.percentage !== null && s.percentage !== undefined;
    const hasFixed = s.fixedAmount !== null && s.fixedAmount !== undefined;
    if (hasPct === hasFixed) return "Each split needs either a percentage or a fixed amount.";
    if (hasPct && (s.percentage! <= 0 || s.percentage! > 100)) return "Percentages must be between 0 and 100.";
    if (hasFixed && s.fixedAmount! <= 0) return "Fixed amounts must be greater than 0.";
  }
  const total = totalCommitted(invoiceAmount, splits);
  if (total > invoiceAmount + 0.005) {
    return `Splits total ${total.toFixed(2)}, which exceeds the invoice total of ${invoiceAmount.toFixed(2)}.`;
  }
  return null;
}
