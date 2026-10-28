/**
 * Propose a PAYOUT_SUBCONTRACTORS action for what subcontractors have earned on an invoice so far.
 * Never pays anything; execution happens only after approval (see executeAction).
 */
import { Prisma } from "@prisma/client";
import { explainPayout } from "@/lib/ai/payoutExplanation";
import { num, prisma } from "@/lib/db";
import { COMMITTED_PAYOUT_STATUSES } from "@/lib/payouts/records";
import { agentInvoiceInclude, payoutKey, type AgentInvoice } from "./context";
import type { PayoutPayload } from "./payloads";
import { computeSharesDue } from "./payoutShares";

export type ProposeResult =
  | { created: true; actionId: string }
  | { created: false; reason: string; actionId?: string };

export function payoutItemsFor(inv: AgentInvoice): PayoutPayload["items"] {
  const amount = num(inv.amount);
  const shares = computeSharesDue(
    amount,
    num(inv.amountPaid),
    inv.payoutSplits.map((s) => ({
      id: s.id,
      percentage: s.percentage === null ? null : num(s.percentage),
      fixedAmount: s.fixedAmount === null ? null : num(s.fixedAmount),
      alreadyPaidOut: s.payouts
        .filter((p) => COMMITTED_PAYOUT_STATUSES.includes(p.status))
        .reduce((sum, p) => sum + num(p.amount), 0),
    })),
  );
  return shares.map((share) => {
    const split = inv.payoutSplits.find((s) => s.id === share.splitId)!;
    return {
      splitId: split.id,
      name: split.subcontractor.name,
      email: split.subcontractor.paypalEmail,
      amount: share.due,
      basis: share.basis,
    };
  });
}

const sameItems = (a: PayoutPayload["items"], b: PayoutPayload["items"]) =>
  a.length === b.length && a.every((x) => b.some((y) => y.splitId === x.splitId && Math.abs(y.amount - x.amount) < 0.005));

export async function proposePayout(invoiceId: string): Promise<ProposeResult> {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: agentInvoiceInclude });
  if (!inv) return { created: false, reason: "invoice not found" };
  if (num(inv.amountPaid) <= 0) return { created: false, reason: "nothing paid yet" };

  const items = payoutItemsFor(inv);
  if (!items.length) return { created: false, reason: "no subcontractor shares due" };

  // An existing pending proposal: keep it if still accurate, otherwise supersede it.
  const pending = inv.agentActions.find(
    (a) => a.type === "PAYOUT_SUBCONTRACTORS" && (a.status === "PROPOSED" || a.status === "APPROVED"),
  );
  if (pending) {
    const current = (pending.payload as unknown as PayoutPayload).items ?? [];
    if (pending.status === "APPROVED" || sameItems(current, items)) {
      return { created: false, reason: "matching payout proposal already pending", actionId: pending.id };
    }
    await prisma.agentAction.updateMany({
      where: { id: pending.id, status: "PROPOSED" },
      data: { status: "REJECTED", decidedAt: new Date(), pendingKey: null, result: { superseded: true, reason: "A new payment changed the amounts due." } },
    });
  }

  const currency = inv.currency;
  const amount = num(inv.amount);
  const amountPaid = num(inv.amountPaid);
  const facts = {
    invoice: inv.number,
    currency,
    invoiceTotal: amount,
    paidSoFar: amountPaid,
    fullyPaid: amountPaid >= amount,
    payouts: items.map((i) => ({ name: i.name, amount: i.amount, basis: i.basis })),
  };

  let explanation: string;
  try {
    explanation = (await explainPayout(facts)).explanation;
  } catch (e) {
    console.warn(`payout explanation failed; using template: ${e instanceof Error ? e.message : e}`);
    explanation = `${inv.number} has received ${amountPaid.toFixed(2)} of ${amount.toFixed(2)} ${currency}. ${items
      .map((i) => `${i.name}: ${i.amount.toFixed(2)} (${i.basis})`)
      .join("; ")}.`;
  }

  const payload: PayoutPayload = { currency, invoiceAmount: amount, amountPaid, explanation, items };
  try {
    const action = await prisma.agentAction.create({
      data: {
        type: "PAYOUT_SUBCONTRACTORS",
        invoiceId: inv.id,
        payload: payload as unknown as Prisma.InputJsonValue,
        reasoning: explanation,
        isDemo: inv.isDemo,
        pendingKey: payoutKey(inv.id),
      },
    });
    return { created: true, actionId: action.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { created: false, reason: "another run proposed this payout concurrently" };
    }
    throw e;
  }
}
