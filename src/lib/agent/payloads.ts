/** Shapes of AgentAction.payload per action type (validated on execute and on edit). */
import { z } from "zod";

export const ReminderPayload = z.object({
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(3000),
});

export const PaymentPlanPayload = ReminderPayload.extend({
  minimumAmount: z.number().positive(),
  installments: z.number().int().min(2).max(12),
  currency: z.string().length(3),
});

export const EscalatePayload = z.object({
  message: z.string().trim().min(1).max(3000),
});

export const PayoutPayload = z.object({
  currency: z.string().length(3),
  invoiceAmount: z.number(),
  amountPaid: z.number(),
  explanation: z.string(),
  items: z
    .array(
      z.object({
        splitId: z.string(),
        name: z.string(),
        email: z.string().email(),
        amount: z.number().positive(),
        basis: z.string(),
      }),
    )
    .min(1),
});

export type ReminderPayload = z.infer<typeof ReminderPayload>;
export type PaymentPlanPayload = z.infer<typeof PaymentPlanPayload>;
export type PayoutPayload = z.infer<typeof PayoutPayload>;

/** Fields a human may change with "Edit & approve". */
export const ActionEdits = z.object({
  subject: z.string().trim().min(1).max(200).optional(),
  message: z.string().trim().min(1).max(3000).optional(),
  minimumAmount: z.number().positive().optional(),
});
export type ActionEdits = z.infer<typeof ActionEdits>;
