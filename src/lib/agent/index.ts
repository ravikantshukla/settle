/**
 * Agent entry points. The agent only ever *proposes* AgentActions; humans approve them,
 * and executeAction() is the only path from a proposal to PayPal.
 */
import { clock } from "@/lib/clock";
import { prisma } from "@/lib/db";
import { proposePayout } from "./proposePayout";

export { runAgent, type RunSummary } from "./runAgent";
export {
  executeAction,
  rejectAction,
  sendScheduledAction,
  dispatchScheduledActions,
  ActionStateError,
  type ExecuteResult,
} from "./executeAction";
export { proposePayout } from "./proposePayout";

export const agent = {
  /** Called when an invoice's paid amount increases (fully or partially paid). */
  async onPaymentReceived(invoiceId: string): Promise<void> {
    const r = await proposePayout(invoiceId);
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { number: true, status: true, amount: true, amountPaid: true, currency: true },
    });
    if (!invoice) return;
    await prisma.agentRunLog.create({
      data: {
        createdAt: await clock.now(),
        trigger: "payment_received",
        invoiceId,
        observations: {
          number: invoice.number,
          status: invoice.status,
          amount: invoice.amount.toString(),
          amountPaid: invoice.amountPaid.toString(),
          currency: invoice.currency,
        },
        decision: r.created
          ? "Payment received. Proposed a subcontractor payout for approval."
          : `Payment received. No payout proposed: ${r.reason}.`,
        actionIds: r.created ? [r.actionId] : [],
      },
    });
  },
};
