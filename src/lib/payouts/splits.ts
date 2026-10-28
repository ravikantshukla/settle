/** Subcontractor + split management (server). */
import { z } from "zod";
import { validateSplits } from "@/lib/agent/payoutShares";
import { num, prisma } from "@/lib/db";

export class SplitValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SplitValidationError";
  }
}

export const SubcontractorInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  paypalEmail: z.string().trim().email("A valid PayPal email is required"),
});

export const SplitsInput = z.object({
  splits: z.array(
    z.object({
      id: z.string().optional(),
      subcontractorId: z.string().min(1, "Choose a subcontractor"),
      percentage: z.number().nullable(),
      fixedAmount: z.number().nullable(),
    }),
  ),
});

/**
 * Replace an invoice's splits. Splits that already have payouts are locked: they must be kept
 * unchanged, because payouts were computed from them.
 */
export async function replaceInvoiceSplits(invoiceId: string, input: z.infer<typeof SplitsInput>) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { payoutSplits: { include: { payouts: { select: { id: true } } } } },
  });
  if (!invoice) throw new SplitValidationError("Invoice not found.");

  const error = validateSplits(num(invoice.amount), input.splits);
  if (error) throw new SplitValidationError(error);

  const subIds = new Set(input.splits.map((s) => s.subcontractorId));
  if (subIds.size !== input.splits.length) throw new SplitValidationError("Each subcontractor can appear only once per invoice.");

  const keptIds = new Set(input.splits.map((s) => s.id).filter(Boolean));
  for (const existing of invoice.payoutSplits) {
    if (!existing.payouts.length) continue;
    const incoming = input.splits.find((s) => s.id === existing.id);
    const same =
      incoming &&
      incoming.subcontractorId === existing.subcontractorId &&
      (incoming.percentage ?? null) === (existing.percentage === null ? null : num(existing.percentage)) &&
      (incoming.fixedAmount ?? null) === (existing.fixedAmount === null ? null : num(existing.fixedAmount));
    if (!keptIds.has(existing.id) || !same) {
      throw new SplitValidationError("Splits that have already been paid out can't be changed or removed.");
    }
  }

  await prisma.$transaction(async (tx) => {
    const removable = invoice.payoutSplits.filter((s) => !s.payouts.length && !keptIds.has(s.id)).map((s) => s.id);
    await tx.payoutSplit.deleteMany({ where: { id: { in: removable } } });
    for (const s of input.splits) {
      const data = { subcontractorId: s.subcontractorId, percentage: s.percentage, fixedAmount: s.fixedAmount };
      const existing = s.id ? invoice.payoutSplits.find((x) => x.id === s.id) : undefined;
      if (existing && existing.payouts.length) continue;
      if (existing) await tx.payoutSplit.update({ where: { id: existing.id }, data });
      else await tx.payoutSplit.create({ data: { ...data, invoiceId } });
    }
  });
}
