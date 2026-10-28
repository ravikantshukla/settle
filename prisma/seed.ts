/**
 * Demo data for one freelancer/agency. Never calls PayPal: every row is flagged isDemo
 * so the UI can badge it and the agent/sync can skip it.
 * Re-running replaces previous demo rows and leaves real data alone.
 */
import { PrismaClient, type InvoiceStatus, type PayoutStatus } from "@prisma/client";

const prisma = new PrismaClient();
const DAY = 86_400_000;
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);

async function clearDemo() {
  await prisma.agentRunLog.deleteMany({ where: { isDemo: true } });
  await prisma.agentAction.deleteMany({ where: { isDemo: true } });
  await prisma.client.deleteMany({ where: { isDemo: true } }); // cascades projects -> invoices -> items/splits
  await prisma.subcontractor.deleteMany({ where: { isDemo: true } });
}

type Line = [description: string, qty: number, unitAmount: number];

interface DemoInvoice {
  number: string;
  clientKey: keyof typeof clients;
  title: string;
  sourceText: string;
  status: InvoiceStatus;
  issuedDaysAgo: number;
  dueInDays: number;
  lines: Line[];
  amountPaid?: number;
  /** [daysAgo, amount] partial payments; must sum to amountPaid. */
  installments?: Array<[number, number]>;
  paidDaysAgo?: number;
  risk?: [score: number, reason: string];
  allowPartial?: boolean;
  minAmountDue?: number;
  splits?: Array<{
    sub: keyof typeof subs;
    percentage?: number;
    fixedAmount?: number;
    payoutStatus?: PayoutStatus;
  }>;
}

const clients = {
  northwind: {
    name: "Maya Patel",
    email: "maya@northwindcoffee.example",
    company: "Northwind Coffee Co.",
    notes: "Pays reliably, usually within a week. Prefers email.",
  },
  brightline: {
    name: "Jordan Lee",
    email: "jordan@brightlinefitness.example",
    company: "Brightline Fitness",
    notes: "New client as of this quarter.",
  },
  harbor: {
    name: "Sam Okafor",
    email: "accounts@harborpine.example",
    company: "Harbor & Pine Architects",
    notes: "AP runs payments on the 1st and 15th. CC Sam on reminders.",
  },
  lumen: {
    name: "Dr. Priya Raman",
    email: "priya@lumenhealth.example",
    company: "Lumen Health Clinic",
    notes: "Mentioned cash-flow issues during the last call.",
  },
  tidewater: {
    name: "Alex Moreno",
    email: "alex@tidewaterbooks.example",
    company: "Tidewater Books",
    notes: "Small indie shop; agreed to pay in installments.",
  },
};

const subs = {
  chen: { name: "Chen Wei", paypalEmail: "chen.wei.illustration@example.com" },
  rosa: { name: "Rosa Alvarez", paypalEmail: "rosa.alvarez.copy@example.com" },
  dev: { name: "Dev Kumar", paypalEmail: "dev.kumar.builds@example.com" },
};

const invoices: DemoInvoice[] = [
  {
    number: "DEMO-1001",
    clientKey: "northwind",
    title: "Brand refresh",
    sourceText:
      "Hi Maya, confirming scope for the Northwind brand refresh: logo refinement, packaging illustrations (Chen will handle these, 25% of the project), and a brand guidelines PDF. Total $4,800, due net 15.",
    status: "PAID",
    issuedDaysAgo: 40,
    dueInDays: -25,
    paidDaysAgo: 28,
    lines: [
      ["Logo refinement", 1, 1200],
      ["Packaging illustrations (3 SKUs)", 3, 800],
      ["Brand guidelines document", 1, 1200],
    ],
    splits: [{ sub: "chen", percentage: 25, payoutStatus: "SUCCESS" }],
  },
  {
    number: "DEMO-1002",
    clientKey: "brightline",
    title: "Class-booking website",
    sourceText:
      "Jordan — as discussed: 5-page marketing site with class schedule embed. $2,400 build + $800 for copy. Invoice due 30 days from send.",
    status: "SENT",
    issuedDaysAgo: 27,
    dueInDays: 3,
    risk: [18, "Not due yet; new client with no payment history"],
    lines: [
      ["Website design & build (5 pages)", 1, 2400],
      ["Website copywriting", 1, 800],
    ],
    splits: [{ sub: "rosa", fixedAmount: 600 }],
  },
  {
    number: "DEMO-1003",
    clientKey: "harbor",
    title: "Portfolio site & CMS",
    sourceText:
      "Agreement: Harbor & Pine portfolio website with headless CMS. Design 40h @ $95, development 30h @ $110. Dev Kumar subcontracting backend for a flat $1,500. Payment due net 30.",
    status: "SENT",
    issuedDaysAgo: 40,
    dueInDays: -10,
    risk: [46, "10 days overdue; AP pays on the 1st/15th, likely next run"],
    lines: [
      ["Design", 40, 95],
      ["Development", 30, 110],
    ],
    splits: [{ sub: "dev", fixedAmount: 1500 }],
  },
  {
    number: "DEMO-1004",
    clientKey: "lumen",
    title: "Patient intake app — phase 1",
    sourceText:
      "Lumen Health phase 1: patient intake form app, HIPAA-conscious hosting setup, staff training session. Fixed fee $9,750 due net 30. Dev Kumar to assist with 20% of the build.",
    status: "SENT",
    issuedDaysAgo: 65,
    dueInDays: -35,
    risk: [82, "35 days overdue, no payments, cash-flow issues noted"],
    lines: [
      ["Intake app build (fixed fee)", 1, 8500],
      ["Hosting & security setup", 1, 750],
      ["Staff training session", 1, 500],
    ],
    splits: [{ sub: "dev", percentage: 20 }],
  },
  {
    number: "DEMO-1005",
    clientKey: "tidewater",
    title: "E-commerce migration",
    sourceText:
      "Alex, we'll migrate Tidewater's store to Shopify: product import, theme customization, and a launch email. $5,600 total; you can pay in installments of at least $800.",
    status: "PARTIALLY_PAID",
    issuedDaysAgo: 21,
    dueInDays: 9,
    amountPaid: 2400,
    installments: [
      [14, 1200],
      [4, 1200],
    ],
    risk: [22, "Paying in installments as agreed; 43% received so far"],
    allowPartial: true,
    minAmountDue: 800,
    lines: [
      ["Product catalog migration", 1, 2200],
      ["Theme customization", 1, 2600],
      ["Launch email campaign", 1, 800],
    ],
    splits: [{ sub: "rosa", fixedAmount: 400 }],
  },
  {
    number: "DEMO-1006",
    clientKey: "northwind",
    title: "Q4 content retainer",
    sourceText:
      "Q4 retainer for Northwind: 4 blog posts and 12 social graphics. Rosa writes the posts (30% split). $3,000 due net 15.",
    status: "PAID",
    issuedDaysAgo: 16,
    dueInDays: -1,
    paidDaysAgo: 2,
    lines: [
      ["Blog posts", 4, 450],
      ["Social graphics", 12, 100],
    ],
    splits: [{ sub: "rosa", percentage: 30 }],
  },
];

async function main() {
  await clearDemo();

  const clientIds: Record<string, string> = {};
  for (const [key, c] of Object.entries(clients)) {
    clientIds[key] = (await prisma.client.create({ data: { ...c, isDemo: true } })).id;
  }
  const subIds: Record<string, string> = {};
  for (const [key, s] of Object.entries(subs)) {
    subIds[key] = (await prisma.subcontractor.create({ data: { ...s, isDemo: true } })).id;
  }

  const invoiceIds: Record<string, string> = {};
  for (const inv of invoices) {
    const amount = inv.lines.reduce((sum, [, qty, unit]) => sum + qty * unit, 0);
    const paid = inv.status === "PAID";
    const issueDate = daysFromNow(-inv.issuedDaysAgo);

    const project = await prisma.project.create({
      data: {
        clientId: clientIds[inv.clientKey],
        title: inv.title,
        sourceText: inv.sourceText,
        isDemo: true,
      },
    });

    const created = await prisma.invoice.create({
      data: {
        projectId: project.id,
        number: inv.number,
        status: inv.status,
        currency: "USD",
        amount,
        amountPaid: paid ? amount : (inv.amountPaid ?? 0),
        issueDate,
        sentAt: issueDate,
        dueDate: daysFromNow(inv.dueInDays),
        paidAt: inv.paidDaysAgo !== undefined ? daysFromNow(-inv.paidDaysAgo) : null,
        paymentTerms: "Net 30",
        allowPartial: inv.allowPartial ?? false,
        minAmountDue: inv.minAmountDue,
        isDemo: true,
        lineItems: {
          create: inv.lines.map(([description, qty, unitAmount], position) => ({
            description,
            qty,
            unitAmount,
            position,
          })),
        },
        payoutSplits: {
          create: (inv.splits ?? []).map((s) => {
            const payoutAmount = s.fixedAmount ?? (amount * (s.percentage ?? 0)) / 100;
            const done = s.payoutStatus === "SUCCESS";
            return {
              subcontractorId: subIds[s.sub],
              percentage: s.percentage,
              fixedAmount: s.fixedAmount,
              payoutStatus: s.payoutStatus ?? "NOT_STARTED",
              payoutAmount: done ? payoutAmount : null,
              payoutBatchId: done ? `DEMO-BATCH-${inv.number}` : null,
              paidOutAt: done ? daysFromNow(-(inv.paidDaysAgo ?? 0) + 1) : null,
              payouts: done
                ? {
                    create: {
                      amount: payoutAmount,
                      currency: "USD",
                      status: "SUCCESS" as const,
                      payoutBatchId: `DEMO-BATCH-${inv.number}`,
                      paidOutAt: daysFromNow(-(inv.paidDaysAgo ?? 0) + 1),
                      isDemo: true,
                    },
                  }
                : undefined,
            };
          }),
        },
        payments: {
          create: paid
            ? [{ amount, currency: "USD", method: "PAYPAL", paidAt: daysFromNow(-(inv.paidDaysAgo ?? 0)), isDemo: true }]
            : (inv.installments ?? []).map(([daysAgo, value]) => ({
                amount: value,
                currency: "USD",
                method: "PAYPAL",
                paidAt: daysFromNow(-daysAgo),
                isDemo: true,
              })),
        },
        agentActions: {
          create: {
            type: "SEND_INVOICE",
            status: "EXECUTED",
            payload: { number: inv.number, amount, recipient: clients[inv.clientKey].email },
            reasoning: "Invoice approved and sent by the user.",
            result: { demo: true },
            proposedAt: issueDate,
            decidedAt: issueDate,
            executedAt: issueDate,
            isDemo: true,
          },
        },
      },
    });
    invoiceIds[inv.number] = created.id;
    if (inv.risk) {
      // fingerprint "seed" marks a sample score; the first AI refresh replaces it.
      await prisma.invoiceRisk.create({
        data: { invoiceId: created.id, score: inv.risk[0], reason: inv.risk[1], fingerprint: "seed", model: null },
      });
    }
  }

  // Agent activity: one executed payout, and a few proposals awaiting approval.
  const splitFor = async (number: string) =>
    (await prisma.payoutSplit.findFirstOrThrow({ where: { invoiceId: invoiceIds[number] } })).id;
  const actions = [
    {
      invoiceId: invoiceIds["DEMO-1001"],
      type: "PAYOUT_SUBCONTRACTORS" as const,
      status: "EXECUTED" as const,
      payload: {
        currency: "USD",
        invoiceAmount: 4800,
        amountPaid: 4800,
        explanation: "DEMO-1001 was paid in full. Chen's agreed share is 25% of $4,800 = $1,200.",
        items: [{ splitId: await splitFor("DEMO-1001"), name: "Chen Wei", email: subs.chen.paypalEmail, amount: 1200, basis: "25% of 4800.00" }],
      },
      reasoning: "DEMO-1001 was paid in full. Chen's agreed share is 25% of $4,800 = $1,200.",
      result: { simulated: true, payout_batch_id: "DEMO-BATCH-DEMO-1001", batch_status: "SUCCESS" },
      proposedAt: daysFromNow(-28),
      decidedAt: daysFromNow(-27),
      executedAt: daysFromNow(-27),
    },
    {
      invoiceId: invoiceIds["DEMO-1006"],
      type: "PAYOUT_SUBCONTRACTORS" as const,
      status: "PROPOSED" as const,
      pendingKey: `payout:${invoiceIds["DEMO-1006"]}`,
      payload: {
        currency: "USD",
        invoiceAmount: 3000,
        amountPaid: 3000,
        explanation: "DEMO-1006 was paid in full 2 days ago. Rosa's share is 30% of $3,000 = $900.",
        items: [{ splitId: await splitFor("DEMO-1006"), name: "Rosa Alvarez", email: subs.rosa.paypalEmail, amount: 900, basis: "30% of 3000.00" }],
      },
      reasoning: "DEMO-1006 was paid in full 2 days ago. Rosa's share is 30% of $3,000 = $900.",
      proposedAt: daysFromNow(-2),
    },
    {
      invoiceId: invoiceIds["DEMO-1003"],
      type: "SEND_REMINDER" as const,
      status: "PROPOSED" as const,
      pendingKey: `collect:${invoiceIds["DEMO-1003"]}`,
      payload: {
        subject: "Friendly reminder: invoice DEMO-1003 (Portfolio site & CMS)",
        message:
          "Hi Sam, a quick reminder that invoice DEMO-1003 for $7,100 was due 10 days ago. I know your AP runs on the 1st and 15th — could this go into the next run? You can pay with the PayPal link in the invoice email. Thanks!",
      },
      reasoning:
        "10 days overdue. Client notes say AP runs on the 1st and 15th, so a polite but firm nudge before the next run is most likely to work.",
      proposedAt: daysFromNow(0),
    },
    {
      invoiceId: invoiceIds["DEMO-1004"],
      type: "OFFER_PAYMENT_PLAN" as const,
      status: "PROPOSED" as const,
      pendingKey: `collect:${invoiceIds["DEMO-1004"]}`,
      payload: {
        installments: 3,
        minimumAmount: 3250,
        currency: "USD",
        subject: "Option to pay invoice DEMO-1004 in installments",
        message:
          "Hi Priya, I'd like to make invoice DEMO-1004 ($9,750) easier to manage: you can now pay it in installments of at least $3,250 using the PayPal link in the invoice email. Let me know if a different schedule works better.",
      },
      reasoning:
        "35 days overdue with no payment, and the client notes mention cash-flow issues. An installment plan is more likely to recover funds than another reminder.",
      proposedAt: daysFromNow(0),
    },
  ];
  const created = [];
  for (const a of actions) created.push(await prisma.agentAction.create({ data: { ...a, isDemo: true } }));

  await prisma.agentRunLog.create({
    data: {
      trigger: "scheduled",
      isDemo: true,
      observations: {
        openInvoices: 4,
        overdue: [
          { number: "DEMO-1003", daysOverdue: 10, amountDue: 6100 },
          { number: "DEMO-1004", daysOverdue: 35, amountDue: 9750 },
        ],
        paidAwaitingPayout: ["DEMO-1006"],
      },
      decision:
        "Proposed a reminder for DEMO-1003, an installment plan for DEMO-1004, and a subcontractor payout for DEMO-1006. DEMO-1002 is due in 3 days; no action yet. DEMO-1005 is on track with installments.",
      actionIds: created.filter((a) => a.status === "PROPOSED").map((a) => a.id),
    },
  });

  console.log(
    `Seeded ${Object.keys(clients).length} clients, ${Object.keys(subs).length} subcontractors, ${invoices.length} invoices, ${actions.length} agent actions.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
