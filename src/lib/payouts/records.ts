/**
 * Mirror PayPal payout items into Payout rows and keep each PayoutSplit's summary current.
 * Shared by action execution, the webhook handler and the manual sync.
 */
import { clock } from "@/lib/clock";
import { PayoutStatus } from "@prisma/client";
import { num, prisma } from "@/lib/db";
import { getPayoutBatch, PayPalError, type PayoutBatch } from "@/lib/paypal";

const KNOWN = new Set<string>(Object.values(PayoutStatus));
/** Payouts that count toward what a subcontractor has been paid (done or still in flight). */
export const COMMITTED_PAYOUT_STATUSES: PayoutStatus[] = ["PENDING", "UNCLAIMED", "ONHOLD", "SUCCESS"];
/** Statuses that can still change on PayPal's side. */
export const OPEN_PAYOUT_STATUSES: PayoutStatus[] = ["PENDING", "UNCLAIMED", "ONHOLD"];

export function toPayoutStatus(s: string | undefined | null): PayoutStatus | null {
  return s && KNOWN.has(s) ? (s as PayoutStatus) : null;
}

/** Recompute a split's summary fields from its payouts. */
export async function refreshSplitSummary(splitId: string): Promise<void> {
  const payouts = await prisma.payout.findMany({ where: { splitId }, orderBy: { createdAt: "asc" } });
  const latest = payouts.at(-1);
  const committed = payouts
    .filter((p) => COMMITTED_PAYOUT_STATUSES.includes(p.status))
    .reduce((sum, p) => sum + num(p.amount), 0);
  const lastSuccess = payouts.filter((p) => p.status === "SUCCESS").at(-1);

  await prisma.payoutSplit.update({
    where: { id: splitId },
    data: {
      payoutAmount: payouts.length ? Math.round(committed * 100) / 100 : null,
      payoutStatus: latest?.status ?? "NOT_STARTED",
      payoutBatchId: latest?.payoutBatchId ?? null,
      payoutItemId: latest?.payoutItemId ?? null,
      paidOutAt: lastSuccess?.paidOutAt ?? null,
    },
  });
}

export interface PayoutItemUpdate {
  payoutItemId?: string;
  senderItemId?: string;
  payoutBatchId?: string;
  status: PayoutStatus;
  timeProcessed?: string;
  error?: string;
}

/** Apply one payout item's state. Returns false if the item isn't ours. */
export async function applyPayoutItem(u: PayoutItemUpdate): Promise<boolean> {
  const payout = await prisma.payout.findFirst({
    where: {
      OR: [
        ...(u.payoutItemId ? [{ payoutItemId: u.payoutItemId }] : []),
        ...(u.senderItemId ? [{ id: u.senderItemId }] : []),
      ],
    },
  });
  if (!payout) return false;

  await prisma.payout.update({
    where: { id: payout.id },
    data: {
      status: u.status,
      payoutItemId: u.payoutItemId ?? payout.payoutItemId,
      payoutBatchId: u.payoutBatchId ?? payout.payoutBatchId,
      error: u.error ?? (u.status === "SUCCESS" ? null : payout.error),
      paidOutAt:
        u.status === "SUCCESS" ? (u.timeProcessed ? await clock.fromReal(u.timeProcessed) : (payout.paidOutAt ?? (await clock.now()))) : payout.paidOutAt,
    },
  });
  await refreshSplitSummary(payout.splitId);
  return true;
}

export async function applyPayoutBatch(batch: PayoutBatch): Promise<number> {
  let applied = 0;
  for (const item of batch.items ?? []) {
    const ok = await applyPayoutItem({
      payoutItemId: item.payout_item_id,
      senderItemId: item.payout_item.sender_item_id,
      payoutBatchId: item.payout_batch_id,
      status: toPayoutStatus(item.transaction_status) ?? "PENDING",
      timeProcessed: item.time_processed,
      error: item.errors?.message,
    });
    if (ok) applied++;
  }
  return applied;
}

export interface PayoutSyncSummary {
  batches: number;
  itemsUpdated: number;
  errors: Array<{ batchId: string; error: string }>;
}

/** Pull every non-final payout batch from PayPal. */
export async function syncOpenPayouts(): Promise<PayoutSyncSummary> {
  const open = await prisma.payout.findMany({
    where: { status: { in: OPEN_PAYOUT_STATUSES }, payoutBatchId: { not: null } },
    select: { payoutBatchId: true },
    distinct: ["payoutBatchId"],
  });
  const summary: PayoutSyncSummary = { batches: open.length, itemsUpdated: 0, errors: [] };
  for (const { payoutBatchId } of open) {
    try {
      summary.itemsUpdated += await applyPayoutBatch(await getPayoutBatch(payoutBatchId!));
    } catch (e) {
      summary.errors.push({
        batchId: payoutBatchId!,
        error: e instanceof PayPalError ? e.toDisplayString() : e instanceof Error ? e.message : String(e),
      });
    }
  }
  return summary;
}
