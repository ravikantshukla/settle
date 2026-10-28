/**
 * Execute an approved AgentAction (the only place agent proposals touch PayPal), or reject one.
 * Demo actions (seed data) are simulated locally and never call PayPal.
 */
import type { AgentAction, Prisma } from "@prisma/client";
import { num, prisma } from "@/lib/db";
import { createPayoutBatch, enablePartialPayment, getPayoutBatch, PayPalError, remindInvoice } from "@/lib/paypal";
import { applyPayoutBatch, refreshSplitSummary } from "@/lib/payouts/records";
import { agentInvoiceInclude, type AgentInvoice } from "./context";
import { ActionEdits, EscalatePayload, PaymentPlanPayload, PayoutPayload, ReminderPayload } from "./payloads";
import { COLLECTIBLE_STATUSES } from "./policy";
import { payoutItemsFor } from "./proposePayout";

export class ActionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionStateError";
  }
}

export interface ExecuteResult {
  actionId: string;
  status: "EXECUTED" | "FAILED";
  simulated: boolean;
  message: string;
  result: Record<string, unknown>;
}

const errorText = (e: unknown) =>
  e instanceof PayPalError ? e.toDisplayString() : e instanceof Error ? e.message : String(e);

function applyEdits(action: AgentAction, edits: ActionEdits | undefined): Prisma.InputJsonValue {
  const payload = { ...(action.payload as Record<string, unknown>) };
  if (!edits) return payload as Prisma.InputJsonValue;
  if (edits.subject !== undefined) payload.subject = edits.subject;
  if (edits.message !== undefined) payload.message = edits.message;
  if (edits.minimumAmount !== undefined && action.type === "OFFER_PAYMENT_PLAN") payload.minimumAmount = edits.minimumAmount;
  return payload as Prisma.InputJsonValue;
}

export async function rejectAction(actionId: string, reason?: string): Promise<void> {
  const { count } = await prisma.agentAction.updateMany({
    where: { id: actionId, status: "PROPOSED" },
    data: { status: "REJECTED", decidedAt: new Date(), pendingKey: null, result: reason ? { reason } : undefined },
  });
  if (!count) throw new ActionStateError("This action was already decided.");
}

/** Approve (optionally with edits) and execute. Safe against double clicks: only one caller wins the claim. */
export async function executeAction(actionId: string, rawEdits?: unknown): Promise<ExecuteResult> {
  const edits = rawEdits === undefined ? undefined : ActionEdits.parse(rawEdits);

  const action = await prisma.agentAction.findUnique({ where: { id: actionId } });
  if (!action) throw new ActionStateError("Action not found.");
  const payload = applyEdits(action, edits);

  const { count } = await prisma.agentAction.updateMany({
    where: { id: actionId, status: "PROPOSED" },
    data: {
      status: "APPROVED",
      decidedAt: new Date(),
      payload,
      result: edits && Object.keys(edits).length ? { editedByUser: true } : undefined,
    },
  });
  if (!count) throw new ActionStateError("This action was already decided.");

  const claimed = { ...action, payload } as AgentAction;
  try {
    const { result, message, simulated } = await perform(claimed);
    await prisma.agentAction.update({
      where: { id: actionId },
      data: {
        status: "EXECUTED",
        executedAt: new Date(),
        pendingKey: null,
        result: { ...result, simulated, editedByUser: !!edits && Object.keys(edits).length > 0 } as Prisma.InputJsonValue,
      },
    });
    return { actionId, status: "EXECUTED", simulated, message, result };
  } catch (e) {
    const error = errorText(e);
    await prisma.agentAction.update({
      where: { id: actionId },
      data: { status: "FAILED", pendingKey: null, result: { error } },
    });
    return { actionId, status: "FAILED", simulated: false, message: error, result: { error } };
  }
}

async function perform(action: AgentAction): Promise<{ result: Record<string, unknown>; message: string; simulated: boolean }> {
  if (!action.invoiceId) throw new Error("Action has no invoice.");
  const invoice = await prisma.invoice.findUnique({ where: { id: action.invoiceId }, include: agentInvoiceInclude });
  if (!invoice) throw new Error("Invoice not found.");
  const simulated = action.isDemo || invoice.isDemo;

  if (action.type !== "PAYOUT_SUBCONTRACTORS" && action.type !== "ESCALATE" && !COLLECTIBLE_STATUSES.includes(invoice.status)) {
    throw new Error(`Invoice ${invoice.number} is now ${invoice.status}; nothing to send. Run the agent again for a fresh proposal.`);
  }
  if (!simulated && !invoice.paypalInvoiceId && action.type !== "ESCALATE" && action.type !== "PAYOUT_SUBCONTRACTORS") {
    throw new Error("Invoice has no PayPal invoice id.");
  }

  switch (action.type) {
    case "SEND_REMINDER": {
      const p = ReminderPayload.parse(action.payload);
      if (!simulated) await remindInvoice(invoice.paypalInvoiceId!, { subject: p.subject, note: p.message });
      return { result: { reminded: true }, message: `Reminder sent for ${invoice.number}.`, simulated };
    }

    case "OFFER_PAYMENT_PLAN": {
      const p = PaymentPlanPayload.parse(action.payload);
      const outstanding = num(invoice.amount) - num(invoice.amountPaid);
      if (p.minimumAmount > outstanding + 0.005) {
        throw new Error(`Minimum installment ${p.minimumAmount} exceeds the outstanding ${outstanding.toFixed(2)}.`);
      }
      if (!simulated) {
        await enablePartialPayment(invoice.paypalInvoiceId!, p.minimumAmount);
        await remindInvoice(invoice.paypalInvoiceId!, { subject: p.subject, note: p.message });
      }
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { allowPartial: true, minAmountDue: p.minimumAmount },
      });
      return {
        result: { partialPaymentEnabled: true, minimumAmount: p.minimumAmount, reminded: true },
        message: `Installments enabled on ${invoice.number} (min ${p.minimumAmount} ${p.currency}) and the client was notified.`,
        simulated,
      };
    }

    case "ESCALATE": {
      EscalatePayload.parse(action.payload);
      return { result: { acknowledged: true }, message: `${invoice.number} flagged for personal follow-up.`, simulated };
    }

    case "PAYOUT_SUBCONTRACTORS":
      return executePayout(action, invoice, simulated);

    default:
      throw new Error(`${action.type} can't be executed from the agent inbox.`);
  }
}

async function executePayout(
  action: AgentAction,
  invoice: AgentInvoice,
  simulated: boolean,
) {
  const p = PayoutPayload.parse(action.payload);

  // Guard against paying more than is currently owed (e.g. a payout already went out meanwhile).
  const dueNow = new Map(payoutItemsFor(invoice).map((i) => [i.splitId, i.amount]));
  for (const item of p.items) {
    if (item.amount > (dueNow.get(item.splitId) ?? 0) + 0.005) {
      throw new Error(`${item.name}'s payout (${item.amount}) is more than currently owed. Run the agent again for a fresh proposal.`);
    }
  }

  const payouts = await prisma.$transaction(
    p.items.map((item) =>
      prisma.payout.create({
        data: {
          splitId: item.splitId,
          agentActionId: action.id,
          amount: item.amount,
          currency: p.currency,
          status: simulated ? "SUCCESS" : "PENDING",
          isDemo: simulated,
          payoutBatchId: simulated ? `DEMO-BATCH-${action.id.slice(-6)}` : null,
          paidOutAt: simulated ? new Date() : null,
        },
      }),
    ),
  );

  if (simulated) {
    for (const po of payouts) await refreshSplitSummary(po.splitId);
    return {
      result: { payout_batch_id: payouts[0]?.payoutBatchId, batch_status: "SUCCESS", items: payouts.length },
      message: `Simulated payout of ${payouts.length} item(s) (demo data).`,
      simulated,
    };
  }

  let batchId: string;
  let batchStatus: string;
  try {
    const batch = await createPayoutBatch({
      senderBatchId: action.id, // idempotency: PayPal rejects a second batch with this id
      emailSubject: `Payout for ${invoice.project.title}`,
      emailMessage: `Your share for invoice ${invoice.number}.`,
      items: p.items.map((item, i) => ({
        email: item.email,
        amount: item.amount,
        currency: p.currency,
        note: `Share for ${invoice.number} (${item.basis})`,
        senderItemId: payouts[i].id,
      })),
    });
    batchId = batch.batch_header.payout_batch_id;
    batchStatus = batch.batch_header.batch_status;
  } catch (e) {
    await prisma.payout.updateMany({
      where: { id: { in: payouts.map((po) => po.id) } },
      data: { status: "FAILED", error: errorText(e) },
    });
    for (const po of payouts) await refreshSplitSummary(po.splitId);
    throw e;
  }

  await prisma.payout.updateMany({ where: { id: { in: payouts.map((po) => po.id) } }, data: { payoutBatchId: batchId } });
  for (const po of payouts) await refreshSplitSummary(po.splitId);

  // Item ids/statuses aren't in the create response; fetch them now (webhook/sync keep them current).
  try {
    await applyPayoutBatch(await getPayoutBatch(batchId));
  } catch (e) {
    console.warn(`Could not fetch payout batch ${batchId} yet`, errorText(e));
  }

  return {
    result: { payout_batch_id: batchId, batch_status: batchStatus, items: payouts.length },
    message: `PayPal payout batch ${batchId} created (${batchStatus}).`,
    simulated,
  };
}
