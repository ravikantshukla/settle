/**
 * Demo data = REAL PayPal sandbox invoices, created through the same code path as the UI
 * (sendNewInvoice), all addressed to SANDBOX_BUYER_EMAIL so they can be paid with the sandbox buyer.
 * Subcontractors are SANDBOX_SUB1_EMAIL / SANDBOX_SUB2_EMAIL so payouts can succeed.
 *
 * Every invoice is due in the future: overdue states come from the demo clock, never from fake dates.
 * "Paid" and "partially paid" states are created with PayPal's record-payment API, then synced back.
 * Paid invoices get a realistic issue-to-payment gap (`paidAfterDays`) by back-dating OUR issue/sent/due
 * dates; PayPal's own invoice date stays the real date. "Avg. days to pay" reads our dates.
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
  client: { name: string; email: string; company: string; notes: string; timezone: string; country: string };
  title: string;
  sourceText: string;
  dueInDays: number;
  lines: Array<[description: string, qty: number, unitPrice: number]>;
  allowPartial?: { minimum: number };
  splits?: Array<{ sub: 0 | 1; name: string; percentage?: number; fixedAmount?: number }>;
  /** Record an external payment of this amount after sending (full amount => paid). */
  recordPayment?: number;
  /** For paid invoices: issued this many days before today, so it was paid after this many days. */
  paidAfterDays?: number;
}

/**
 * The freelancer is Aarav Mishra in Lucknow (see Settings); clients are in the US and UK and are
 * billed in USD. Subcontractors are Indian freelancers paid through PayPal Payouts.
 */
export const DEMO_INVOICES: DemoInvoiceSpec[] = [
  {
    key: "hudson",
    client: {
      name: "Emily Carter",
      email: "emily@hudsonpikecoffee.example",
      company: "Hudson & Pike Coffee",
      notes: "Brooklyn roastery. Pays reliably, usually within two weeks.",
      timezone: "America/New_York",
      country: "US",
    },
    title: "Brand refresh",
    sourceText: "Brand refresh for Hudson & Pike (Brooklyn, NY): logo refinement, packaging illustrations (Neha gets 25%), brand guidelines. $4,800, net 14.",
    dueInDays: 14,
    lines: [
      ["Logo refinement", 1, 1200],
      ["Packaging illustrations (3 SKUs)", 3, 800],
      ["Brand guidelines document", 1, 1200],
    ],
    splits: [{ sub: 0, name: "Neha Verma", percentage: 25 }],
    recordPayment: 4800,
    paidAfterDays: 9,
  },
  {
    key: "thames",
    client: {
      name: "Oliver Bennett",
      email: "oliver@thameslanestudio.example",
      company: "Thames Lane Studio",
      notes: "London design studio. Pays at the end of their two-week billing cycle.",
      timezone: "Europe/London",
      country: "GB",
    },
    title: "Newsletter templates",
    sourceText: "Three reusable email newsletter templates for Thames Lane Studio (London), $650 each. Net 15.",
    dueInDays: 15,
    lines: [["Email newsletter template", 3, 650]],
    recordPayment: 1950,
    paidAfterDays: 14,
  },
  {
    key: "bayside",
    client: {
      name: "Jordan Lee",
      email: "jordan@baysidefitness.example",
      company: "Bayside Fitness",
      notes: "San Francisco gym chain. New client as of this quarter.",
      timezone: "America/Los_Angeles",
      country: "US",
    },
    title: "Class-booking website",
    sourceText: "5-page marketing site with class schedule embed for Bayside Fitness (San Francisco). $2,400 build + $800 copy. Due in 3 days.",
    dueInDays: 3,
    lines: [
      ["Website design & build (5 pages)", 1, 2400],
      ["Website copywriting", 1, 800],
    ],
    splits: [{ sub: 1, name: "Rohan Gupta", fixedAmount: 600 }],
  },
  {
    key: "kingsley",
    client: {
      name: "Sophie Clarke",
      email: "accounts@kingsleyrowe.example",
      company: "Kingsley & Rowe Architects",
      notes: "Manchester practice. AP runs payments on the 1st and 15th.",
      timezone: "Europe/London",
      country: "GB",
    },
    title: "Portfolio site & CMS",
    sourceText: "Design 40h @ $95, development 30h @ $110 for Kingsley & Rowe (Manchester, UK). Rohan subcontracts the backend for a flat $1,500. Net 10.",
    dueInDays: 10,
    lines: [
      ["Design", 40, 95],
      ["Development", 30, 110],
    ],
    splits: [{ sub: 1, name: "Rohan Gupta", fixedAmount: 1500 }],
  },
  {
    key: "lumen",
    client: {
      name: "Priya Raman",
      email: "priya@lumenhealth.example",
      company: "Lumen Health Clinic",
      notes: "Austin, Texas clinic. Mentioned cash-flow issues during the last call.",
      timezone: "America/Chicago",
      country: "US",
    },
    title: "Patient intake app, phase 1",
    sourceText: "Phase 1 intake app, hosting setup and staff training for Lumen Health (Austin, TX). Fixed fee $9,750, net 20.",
    dueInDays: 20,
    lines: [
      ["Intake app build (fixed fee)", 1, 8500],
      ["Hosting & security setup", 1, 750],
      ["Staff training session", 1, 500],
    ],
  },
  {
    key: "wrenfield",
    client: {
      name: "Alasdair Reid",
      email: "alasdair@wrenfieldbooks.example",
      company: "Wrenfield Books",
      notes: "Edinburgh bookshop. Agreed to pay in installments.",
      timezone: "Europe/London",
      country: "GB",
    },
    title: "E-commerce migration",
    sourceText: "Shopify migration for Wrenfield Books (Edinburgh): catalog, theme, launch email. $5,600; installments of at least $800. Net 21.",
    dueInDays: 21,
    lines: [
      ["Product catalog migration", 1, 2200],
      ["Theme customization", 1, 2600],
      ["Launch email campaign", 1, 800],
    ],
    allowPartial: { minimum: 800 },
    splits: [{ sub: 0, name: "Neha Verma", fixedAmount: 400 }],
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
    // Paid invoices are "issued" in the past; the due date keeps its terms relative to that issue date.
    const issued = new Date(today.getTime() - (spec.paidAfterDays ?? 0) * DAY);
    const due = new Date(issued.getTime() + spec.dueInDays * DAY);
    try {
      const reviewed: ReviewedInvoice = {
        requestId: crypto.randomUUID(),
        sourceText: spec.sourceText,
        client: { name: spec.client.name, email: spec.client.email, company: spec.client.company, timezone: spec.client.timezone, country: spec.client.country },
        projectTitle: spec.title,
        currency: "USD",
        lineItems: spec.lines.map(([description, quantity, unitPrice]) => ({ description, quantity, unitPrice })),
        dueDate: due.toISOString().slice(0, 10),
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
      if (spec.paidAfterDays) {
        await prisma.invoice.update({ where: { id: sent.invoiceId }, data: { issueDate: issued, sentAt: issued, dueDate: due, paidAt: today } });
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
    prisma.clientReply.deleteMany(),
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
