import { describe, expect, it } from "vitest";
import { computeSharesDue, fullShare, totalCommitted, validateSplits } from "@/lib/agent/payoutShares";

const pct = (id: string, percentage: number, alreadyPaidOut = 0) => ({ id, percentage, fixedAmount: null, alreadyPaidOut });
const fixed = (id: string, fixedAmount: number, alreadyPaidOut = 0) => ({ id, percentage: null, fixedAmount, alreadyPaidOut });

describe("fullShare", () => {
  it("computes percentage shares of the invoice total", () => {
    expect(fullShare({ percentage: 25, fixedAmount: null }, 4800)).toBe(1200);
  });
  it("uses the fixed amount as-is", () => {
    expect(fullShare({ percentage: null, fixedAmount: 1500 }, 6100)).toBe(1500);
  });
  it("rounds percentage shares to cents", () => {
    expect(fullShare({ percentage: 33.333, fixedAmount: null }, 1000)).toBe(333.33);
  });
});

describe("computeSharesDue", () => {
  it("pays full shares when the invoice is fully paid", () => {
    const due = computeSharesDue(3000, 3000, [pct("rosa", 30)]);
    expect(due).toEqual([expect.objectContaining({ splitId: "rosa", due: 900, earned: 900, fullShare: 900 })]);
  });

  it("pays proportionally on a partial payment", () => {
    // 2400 of 5600 received => 3/7 of a 400 fixed share = 171.428… => floored to 171.42
    const [share] = computeSharesDue(5600, 2400, [fixed("rosa", 400)]);
    expect(share.due).toBe(171.42);
    expect(share.basis).toMatch(/42\.9% paid so far/);
  });

  it("floors to cents so installments never overpay, and the final payment releases the remainder", () => {
    const total = 1000;
    const splits = [pct("a", 33.33)]; // full share 333.30
    const first = computeSharesDue(total, 333.33, splits)[0].due; // 1/3 paid => 111.0999 -> 111.09
    expect(first).toBe(111.09);
    const second = computeSharesDue(total, 666.66, [pct("a", 33.33, first)])[0].due;
    const final = computeSharesDue(total, 1000, [pct("a", 33.33, first + second)])[0].due;
    expect(Math.round((first + second + final) * 100) / 100).toBe(333.3);
  });

  it("subtracts what was already paid out and skips splits with nothing due", () => {
    const due = computeSharesDue(4800, 4800, [pct("chen", 25, 1200), fixed("dev", 500, 100)]);
    expect(due).toEqual([expect.objectContaining({ splitId: "dev", due: 400 })]);
  });

  it("returns nothing when nothing has been paid", () => {
    expect(computeSharesDue(1000, 0, [pct("a", 50)])).toEqual([]);
  });

  it("caps the paid fraction at 100% (overpayment does not inflate shares)", () => {
    expect(computeSharesDue(1000, 1500, [pct("a", 10)])[0].due).toBe(100);
  });

  it("handles a zero-amount invoice", () => {
    expect(computeSharesDue(0, 0, [pct("a", 10)])).toEqual([]);
  });
});

describe("validateSplits", () => {
  it("accepts splits within the invoice total", () => {
    expect(validateSplits(1000, [{ percentage: 50, fixedAmount: null }, { percentage: null, fixedAmount: 500 }])).toBeNull();
  });
  it("rejects splits that exceed the invoice total", () => {
    expect(validateSplits(1000, [{ percentage: 60, fixedAmount: null }, { percentage: null, fixedAmount: 500 }])).toMatch(/exceeds/);
  });
  it("requires exactly one of percentage or fixed amount", () => {
    expect(validateSplits(1000, [{ percentage: 10, fixedAmount: 10 }])).toMatch(/either/);
    expect(validateSplits(1000, [{ percentage: null, fixedAmount: null }])).toMatch(/either/);
  });
  it("rejects out-of-range values", () => {
    expect(validateSplits(1000, [{ percentage: 0, fixedAmount: null }])).toMatch(/between 0 and 100/);
    expect(validateSplits(1000, [{ percentage: null, fixedAmount: -5 }])).toMatch(/greater than 0/);
  });
  it("totals committed amounts", () => {
    expect(totalCommitted(2000, [{ percentage: 10, fixedAmount: null }, { percentage: null, fixedAmount: 50 }])).toBe(250);
  });
});
