/**
 * Execute an approved AgentAction (the only place agent proposals touch PayPal), or reject one.
 */
import type { AgentAction, Prisma } from "@prisma/client";
import { clock } from "@/lib/clock";
import { num, prisma } from "@/lib/db";
import { createPayoutBatch, enablePartialPayment, getPayoutBatch, PayPalError, remindInvoice } from "@/lib/paypal";
import { applyPayoutBatch, refreshSplitSummary } from "@/lib/payouts/records";
import { agentInvoiceInclude, type AgentInvoice } from "./context";
import { ActionEdits, EscalatePayload, PaymentPlanPayload, PayoutPayload, ReminderPayload } from "./payloads";
import { COLLECTIBLE_STATUSES } from "./policy";
import { payoutItemsFor } from "./proposePayout";
import { getSettings } from "@/lib/settings";
import { describeSendTiming, isValidTimeZone, nextSendWindow } from "@/lib/timezone";

export class ActionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionStateError";
  }
}

export interface ExecuteResult {
  actionId: string;
  status: "EXECUTED" | "FAILED" | "SCHEDULED";
  message: string;
  result: Record<string, unknown>;
}

const errorText = (e: unknown) =>
  e instanceof PayPalError ? e.toDisplayString() : e instanceof Error ? e.message : String(e);

const CLIENT_FACING = new Set<string>(["SEND_REMINDER", "OFFER_PAYMENT_PLAN"]);

function applyEdits(action: AgentAction, edits: ActionEdits | undefined): Prisma.InputJsonValue {
  const payload = { ...(action.payload as Record<string, unknown>) };
  if (!edits) return payload as Prisma.InputJsonValue;
  if (edits.subject !== undefined) payload.subject = edits.subject;
  if (edits.message !== undefined) payload.message = edits.message;
  if (edits.minimumAmount !== undefined && action.type === "OFFER_PAYMENT_PLAN") payload.minimumAmount = edits.minimumAmount;
  return payload as Prisma.InputJsonValue;
}

/** Reject a proposal, or cancel an approved message that is still waiting for its send window. */
export async function rejectAction(actionId: string, reason?: string): Promise<void> {
  const { count } = await prisma.agentAction.updateMany({
    where: { id: actionId, status: { in: ["PROPOSED", "SCHEDULED"] } },
    data: { status: "REJECTED", decidedAt: await clock.now(), pendingKey: null, scheduledFor: null, result: reason ? { reason } : undefined },
  });
  if (!count) throw new ActionStateError("This action was already decided.");
}

/**
 * Approve (optionally with edits). Client-facing messages wait for the client's business hours
 * (weekdays 9:00–18:00 in their timezone, on the demo clock) unless `sendNow`; everything else
 * executes right away. Safe against double clicks: only one caller wins the claim.
 */
export async function executeAction(actionId: string, rawEdits?: unknown, opts: { sendNow?: boolean } = {}): Promise<ExecuteResult> {
  const edits = rawEdits === undefined ? undefined : ActionEdits.parse(rawEdits);
  const edited = !!edits && Object.keys(edits).length > 0;

  const action = await prisma.agentAction.findUnique({
    where: { id: actionId },
    include: { invoice: { select: { project: { select: { client: { select: { timezone: true } } } } } } },
  });
  if (!action) throw new ActionStateError("Action not found.");
  const payload = applyEdits(action, edits);

  const now = await clock.now();
  const sendAt = CLIENT_FACING.has(action.type) && !opts.sendNow ? scheduledSendTime(now, action.invoice?.project.client.timezone) : null;
  const result = edited ? { editedByUser: true } : undefined;

  if (sendAt) {
    const { count } = await prisma.agentAction.updateMany({
      where: { id: actionId, status: "PROPOSED" },
      data: { status: "SCHEDULED", decidedAt: now, scheduledFor: sendAt, payload, result },
    });
    if (!count) throw new ActionStateError("This action was already decided.");
    const timing = describeSendTiming(now, action.invoice?.project.client.timezone, (await getSettings()).timezone);
    return { actionId, status: "SCHEDULED", message: `Approved. ${timing.text}.`, result: { scheduledFor: sendAt.toISOString() } };
  }

  const { count } = await prisma.agentAction.updateMany({
    where: { id: actionId, status: "PROPOSED" },
    data: { status: "APPROVED", decidedAt: now, payload, result },
  });
  if (!count) throw new ActionStateError("This action was already decided.");
  return finish({ ...action, payload } as AgentAction, edited);
}

/** When to send a client-facing message approved at `now`, or null to send immediately. */
function scheduledSendTime(now: Date, clientTz: string | null | undefined): Date | null {
  if (!isValidTimeZone(clientTz)) return null;
  const at = nextSendWindow(now, clientTz);
  return at.getTime() > now.getTime() ? at : null;
}

/** Send a SCHEDULED message now (its window opened, or the user clicked "Send now"). */
export async function sendScheduledAction(actionId: string, opts: { force?: boolean } = {}): Promise<ExecuteResult> {
  const now = await clock.now();
  const { count } = await prisma.agentAction.updateMany({
    where: { id: actionId, status: "SCHEDULED", ...(!opts.force && { scheduledFor: { lte: now } }) },
    data: { status: "APPROVED" },
  });
  if (!count) throw new ActionStateError(opts.force ? "This message isn't waiting to be sent." : "This message isn't due yet.");
  const action = await prisma.agentAction.findUniqueOrThrow({ where: { id: actionId } });
  return finish(action, (action.result as { editedByUser?: boolean } | null)?.editedByUser === true);
}

/** Send every scheduled message whose window has opened (called by agent runs, the cron and the demo clock). */
export async function dispatchScheduledActions(): Promise<ExecuteResult[]> {
  const due = await prisma.agentAction.findMany({
    where: { status: "SCHEDULED", scheduledFor: { lte: await clock.now() } },
    orderBy: { scheduledFor: "asc" },
    select: { id: true },
  });
  const out: ExecuteResult[] = [];
  for (const { id } of due) {
    try {
      out.push(await sendScheduledAction(id));
    } catch (e) {
      if (!(e instanceof ActionStateError)) throw e; // someone else sent or cancelled it meanwhile
    }
  }
  return out;
}

/** Run an APPROVED action against PayPal and record the outcome. */
async function finish(claimed: AgentAction, edited: boolean): Promise<ExecuteResult> {
  const actionId = claimed.id;
  try {
    const { result, message } = await perform(claimed);
    await prisma.agentAction.update({
      where: { id: actionId },
      data: {
        status: "EXECUTED",
        executedAt: await clock.now(),
        pendingKey: null,
        result: { ...result, editedByUser: edited } as Prisma.InputJsonValue,
      },
    });
    return { actionId, status: "EXECUTED", message, result };
  } catch (e) {
    const error = errorText(e);
    await prisma.agentAction.update({
      where: { id: actionId },
      data: { status: "FAILED", pendingKey: null, result: { error } },
    });
    return { actionId, status: "FAILED", message: error, result: { error } };
  }
}

async function perform(action: AgentAction): Promise<{ result: Record<string, unknown>; message: string }> {
  if (!action.invoiceId) throw new Error("Action has no invoice.");
  const invoice = await prisma.invoice.findUnique({ where: { id: action.invoiceId }, include: agentInvoiceInclude });
  if (!invoice) throw new Error("Invoice not found.");

  const contactsClient = action.type === "SEND_REMINDER" || action.type === "OFFER_PAYMENT_PLAN";
  if (contactsClient && !COLLECTIBLE_STATUSES.includes(invoice.status)) {
    throw new Error(`Invoice ${invoice.number} is now ${invoice.status}; nothing to send. Run the agent again for a fresh proposal.`);
  }
  if (contactsClient && !invoice.paypalInvoiceId) throw new Error("Invoice has no PayPal invoice id.");

  switch (action.type) {
    case "SEND_REMINDER": {
      const p = ReminderPayload.parse(action.payload);
      await remindInvoice(invoice.paypalInvoiceId!, { subject: p.subject, note: p.message });
      return { result: { reminded: true }, message: `Reminder sent through PayPal for ${invoice.number}.` };
    }

    case "OFFER_PAYMENT_PLAN": {
      const p = PaymentPlanPayload.parse(action.payload);
      const outstanding = num(invoice.amount) - num(invoice.amountPaid);
      if (p.minimumAmount > outstanding + 0.005) {
        throw new Error(`Minimum installment ${p.minimumAmount} exceeds the outstanding ${outstanding.toFixed(2)}.`);
      }
      await enablePartialPayment(invoice.paypalInvoiceId!, p.minimumAmount);
      await remindInvoice(invoice.paypalInvoiceId!, { subject: p.subject, note: p.message });
      await prisma.invoice.update({ where: { id: invoice.id }, data: { allowPartial: true, minAmountDue: p.minimumAmount } });
      return {
        result: { partialPaymentEnabled: true, minimumAmount: p.minimumAmount, reminded: true },
        message: `Installments enabled on the PayPal invoice ${invoice.number} (min ${p.minimumAmount} ${p.currency}) and the client was notified.`,
      };
    }

    case "ESCALATE": {
      EscalatePayload.parse(action.payload);
      return { result: { acknowledged: true }, message: `${invoice.number} flagged for personal follow-up.` };
    }

    case "PAYOUT_SUBCONTRACTORS":
      return executePayout(action, invoice);

    default:
      throw new Error(`${action.type} can't be executed from the agent inbox.`);
  }
}

async function executePayout(action: AgentAction, invoice: AgentInvoice) {
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
        data: { splitId: item.splitId, agentActionId: action.id, amount: item.amount, currency: p.currency, status: "PENDING" },
      }),
    ),
  );

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
  };
}
