/**
 * Agent entry points. The agent only ever *proposes* AgentActions; humans approve them.
 */
import { prisma } from "@/lib/db";

export const agent = {
  /**
   * Called when an invoice's paid amount increases (fully or partially paid).
   * TODO: propose PAYOUT_SUBCONTRACTORS (when fully paid) or adjust the payment plan.
   */
  async onPaymentReceived(invoiceId: string): Promise<void> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { number: true, status: true, amount: true, amountPaid: true, currency: true },
    });
    if (!invoice) return;
    await prisma.agentRunLog.create({
      data: {
        trigger: "payment_received",
        invoiceId,
        observations: {
          number: invoice.number,
          status: invoice.status,
          amount: invoice.amount.toString(),
          amountPaid: invoice.amountPaid.toString(),
          currency: invoice.currency,
        },
        decision: "Payment recorded. (Agent stub: no actions proposed yet.)",
      },
    });
  },
};
