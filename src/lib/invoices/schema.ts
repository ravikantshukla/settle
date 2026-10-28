/**
 * Shared (client + server) zod schemas for the extraction result and the reviewed invoice.
 * No server-only imports here.
 */
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const ExtractionSchema = z.object({
  client: z.object({
    name: z.string(),
    email: z.string().nullable(),
    company: z.string().nullable(),
  }),
  projectTitle: z.string(),
  currency: z.string().length(3),
  lineItems: z
    .array(
      z.object({
        description: z.string(),
        quantity: z.number().positive(),
        unitPrice: z.number().nonnegative(),
      }),
    )
    .min(1),
  dueDate: isoDate.nullable(),
  paymentTerms: z.string().nullable(),
  partialPayment: z.object({
    allowed: z.boolean(),
    minimumAmount: z.number().nonnegative().nullable(),
  }),
  subcontractorSplits: z.array(
    z.object({
      name: z.string(),
      email: z.string().nullable(),
      percentage: z.number().min(0).max(100).nullable(),
      fixedAmount: z.number().nonnegative().nullable(),
    }),
  ),
  confidence: z.number().min(0).max(1),
  uncertainFields: z.array(z.string()),
  notes: z.string().nullable(),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

/** What the user approves on the review form. */
export const ReviewedInvoiceSchema = z
  .object({
    requestId: z.string().uuid(),
    sourceText: z.string().optional(),
    client: z.object({
      name: z.string().trim().min(1, "Client name is required"),
      email: z.string().trim().email("A valid client email is required"),
      company: z.string().trim().optional(),
    }),
    projectTitle: z.string().trim().min(1, "Project title is required"),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, "3-letter currency code")
      .transform((s) => s.toUpperCase()),
    lineItems: z
      .array(
        z.object({
          description: z.string().trim().min(1, "Description is required"),
          quantity: z.number().positive("Quantity must be > 0"),
          unitPrice: z.number().nonnegative("Price must be ≥ 0"),
        }),
      )
      .min(1, "Add at least one line item"),
    dueDate: isoDate.optional(),
    paymentTerms: z.string().trim().optional(),
    allowPartial: z.boolean(),
    minAmountDue: z.number().positive().optional(),
    note: z.string().trim().max(4000).optional(),
    splits: z.array(
      z
        .object({
          name: z.string().trim().min(1, "Subcontractor name is required"),
          email: z.string().trim().email("Subcontractor PayPal email is required"),
          percentage: z.number().gt(0).max(100).optional(),
          fixedAmount: z.number().positive().optional(),
        })
        .refine((s) => (s.percentage === undefined) !== (s.fixedAmount === undefined), {
          message: "Set either a percentage or a fixed amount",
        }),
    ),
  })
  .refine((v) => !v.allowPartial || v.minAmountDue === undefined || v.minAmountDue <= invoiceTotal(v.lineItems), {
    message: "Minimum partial payment cannot exceed the invoice total",
    path: ["minAmountDue"],
  });
export type ReviewedInvoice = z.infer<typeof ReviewedInvoiceSchema>;

export function invoiceTotal(items: Array<{ quantity: number; unitPrice: number }>): number {
  return Math.round(items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0) * 100) / 100;
}
