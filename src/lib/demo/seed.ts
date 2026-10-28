/**
 * Demo data = REAL PayPal sandbox invoices, created through the same code path as the UI
 * (sendNewInvoice), all addressed to SANDBOX_BUYER_EMAIL so they can be paid with the sandbox buyer.
 * Subcontractors are SANDBOX_SUB1_EMAIL / SANDBOX_SUB2_EMAIL so payouts can succeed.
 *
 * Every invoice is due in the future: overdue states come from the demo clock, never from fake dates.
 * "Paid" and "partially paid" states are created with PayPal's record-payment API, then synced back.
 */
import { clock } from "@/lib/clock";
import { prisma } from "@/lib/db";
import { applyPayPalInvoice } from "@/lib/invoices/syncFromPayPal";
import { sendNewInvoice } from "@/lib/invoices/sendNewInvoice";
import type { ReviewedInvoice } from "@/lib/invoices/schema";
import { cancelInvoice, getInvoice, PayPalError, recordPayment } from "@/lib/paypal";
import { COLLECTIBLE_STATUSES } from "@/lib/agent/policy";
import { DemoConfigError, sandboxSubcontractorEmails } from "./routing";

const DAY = 86_400_000;

export interface DemoInvoiceSpec {
  key: string;
  client: { name: string; email: string; company: string; notes: string };
  title: string;
  sourceText: string;
  dueInDays: number;
  lines: Array<[description: string, qty: number, unitPrice: number]>;
  allowPartial?: { minimum: number };
  splits?: Array<{ sub: 0 | 1; name: string; percentage?: number; fixedAmount?: number }>;
  /** Record an external payment of this amount after sending (full amount => paid). */
  recordPayment?: number;
}

export const DEMO_INVOICES: DemoInvoiceSpec[] = [
  {
    key: "northwind",
    client: { name: "Maya Patel", email: "maya@northwindcoffee.example", company: "Northwind Coffee Co.", notes: "Pays reliably, usually within a week." },
    title: "Brand refresh",
    sourceText: "Brand refresh for Northwind: logo refinement, packaging illustrations (Chen gets 25%), brand guidelines. $4,800, net 14.",
    dueInDays: 14,
    lines: [
      ["Logo refinement", 1, 1200],
      ["Packaging illustrations (3 SKUs)", 3, 800],
      ["Brand guidelines document", 1, 1200],
    ],
    splits: [{ sub: 0, name: "Chen Wei", percentage: 25 }],
    recordPayment: 4800,
  },
  {
    key: "brightline",
    client: { name: "Jordan Lee", email: "jordan@brightlinefitness.example", company: "Brightline Fitness", notes: "New client as of this quarter." },
    title: "Class-booking website",
    sourceText: "5-page marketing site with class schedule embed. $2,400 build + $800 copy. Due in 3 days.",
    dueInDays: 3,
    lines: [
      ["Website design & build (5 pages)", 1, 2400],
      ["Website copywriting", 1, 800],
    ],
    splits: [{ sub: 1, name: "Rosa Alvarez", fixedAmount: 600 }],
  },
  {
    key: "harbor",
    client: { name: "Sam Okafor", email: "accounts@harborpine.example", company: "Harbor & Pine Architects", notes: "AP runs payments on the 1st and 15th." },
    title: "Portfolio site & CMS",
    sourceText: "Design 40h @ $95, development 30h @ $110. Dev subcontracting backend for a flat $1,500. Net 10.",
    dueInDays: 10,
    lines: [
      ["Design", 40, 95],
      ["Development", 30, 110],
    ],
    splits: [{ sub: 1, name: "Dev Kumar", fixedAmount: 1500 }],
  },
  {
    key: "lumen",
    client: { name: "Priya Raman", email: "priya@lumenhealth.example", company: "Lumen Health Clinic", notes: "Mentioned cash-flow issues during the last call." },
    title: "Patient intake app, phase 1",
    sourceText: "Phase 1 intake app, hosting setup and staff training. Fixed fee $9,750, net 20.",
    dueInDays: 20,
    lines: [
      ["Intake app build (fixed fee)", 1, 8500],
      ["Hosting & security setup", 1, 750],
      ["Staff training session", 1, 500],
    ],
  },
  {
    key: "tidewater",
    client: { name: "Alex Moreno", email: "alex@tidewaterbooks.example", company: "Tidewater Books", notes: "Agreed to pay in installments." },
    title: "E-commerce migration",
    sourceText: "Shopify migration: catalog, theme, launch email. $5,600; installments of at least $800. Net 21.",
    dueInDays: 21,
    lines: [
      ["Product catalog migration", 1, 2200],
      ["Theme customization", 1, 2600],
      ["Launch email campaign", 1, 800],
    ],
    allowPartial: { minimum: 800 },
    splits: [{ sub: 0, name: "Rosa Alvarez", fixedAmount: 400 }],
    recordPayment: 2400,
  },
];

export interface SeedResult {
  created: Array<{ number: string; status: string; paypalInvoiceId: string }>;
  errors: Array<{ key: string; error: string }>;
}

const errorText = (e: unknown) => (e instanceof PayPalError ? e.toDisplayString() : e instanceof Error ? e.message : String(e));

export function demoSeedConfigError(): string | null {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) return "PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set.";
  if (!process.env.SANDBOX_BUYER_EMAIL) return "SANDBOX_BUYER_EMAIL is not set.";
  try {
    sandboxSubcontractorEmails();
  } catch (e) {
    return e instanceof DemoConfigError ? e.message : String(e);
  }
  return null;
}

/** Create the demo invoices in the PayPal sandbox and mirror them locally. */
export async function seedDemo(): Promise<SeedResult> {
  const configError = demoSeedConfigError();
  if (configError) throw new DemoConfigError(`Can't seed demo data: ${configError}`);
  const buyer = process.env.SANDBOX_BUYER_EMAIL!;
  const subEmails = sandboxSubcontractorEmails();
  const today = await clock.now();

  const result: SeedResult = { created: [], errors: [] };
  for (const spec of DEMO_INVOICES) {
    try {
      const reviewed: ReviewedInvoice = {
        requestId: crypto.randomUUID(),
        sourceText: spec.sourceText,
        client: { name: spec.client.name, email: spec.client.email, company: spec.client.company },
        projectTitle: spec.title,
        currency: "USD",
        lineItems: spec.lines.map(([description, quantity, unitPrice]) => ({ description, quantity, unitPrice })),
        dueDate: new Date(today.getTime() + spec.dueInDays * DAY).toISOString().slice(0, 10),
        paymentTerms: `Net ${spec.dueInDays}`,
        allowPartial: !!spec.allowPartial,
        minAmountDue: spec.allowPartial?.minimum,
        splits: (spec.splits ?? []).map((s) => ({ name: s.name, email: subEmails[s.sub], percentage: s.percentage, fixedAmount: s.fixedAmount })),
      };
      const sent = await sendNewInvoice(reviewed, { forceRecipient: buyer, isDemo: true, clientNotes: spec.client.notes });

      if (spec.recordPayment) {
        await recordPayment(sent.paypalInvoiceId, { amount: spec.recordPayment, currency: "USD", method: "BANK_TRANSFER", note: "Demo seed payment" });
        const local = await prisma.invoice.findUniqueOrThrow({ where: { id: sent.invoiceId } });
        // Syncing back triggers agent.onPaymentReceived -> a payout proposal for the splits.
        await applyPayPalInvoice(local, await getInvoice(sent.paypalInvoiceId));
      }
      const final = await prisma.invoice.findUniqueOrThrow({ where: { id: sent.invoiceId } });
      result.created.push({ number: final.number, status: final.status, paypalInvoiceId: sent.paypalInvoiceId });
    } catch (e) {
      result.errors.push({ key: spec.key, error: errorText(e) });
    }
  }
  return result;
}

/** Cancel open sandbox invoices from a previous demo so the buyer's PayPal account stays tidy. */
export async function cancelOpenSandboxInvoices(): Promise<{ cancelled: number; failed: Array<{ number: string; error: string }> }> {
  const open = await prisma.invoice.findMany({
    where: { paypalInvoiceId: { not: null }, status: { in: COLLECTIBLE_STATUSES } },
    select: { number: true, paypalInvoiceId: true },
  });
  const out = { cancelled: 0, failed: [] as Array<{ number: string; error: string }> };
  for (const inv of open) {
    try {
      await cancelInvoice(inv.paypalInvoiceId!, { notifyRecipient: false, note: "Demo reset" });
      out.cancelled++;
    } catch (e) {
      // e.g. partially paid invoices can't be cancelled; that's fine for a sandbox.
      out.failed.push({ number: inv.number, error: errorText(e) });
    }
  }
  return out;
}

/** Delete ALL local data (demo and real). */
export async function clearAll() {
  await prisma.$transaction([
    prisma.webhookEvent.deleteMany(),
    prisma.agentRunLog.deleteMany(),
    prisma.agentAction.deleteMany(),
    prisma.invoiceRisk.deleteMany(),
    prisma.invoicePayment.deleteMany(),
    prisma.payout.deleteMany(),
    prisma.payoutSplit.deleteMany(),
    prisma.invoiceLineItem.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.project.deleteMany(),
    prisma.client.deleteMany(),
    prisma.subcontractor.deleteMany(),
  ]);
}

/** Reset demo: cancel old sandbox invoices, wipe local data, reset the clock, create fresh demo invoices. */
export async function resetDemo() {
  const configError = demoSeedConfigError();
  if (configError) throw new DemoConfigError(`Can't reset the demo: ${configError}`);
  const cancelled = await cancelOpenSandboxInvoices();
  await clearAll();
  await clock.reset();
  const seeded = await seedDemo();
  return { cancelled, seeded };
}
