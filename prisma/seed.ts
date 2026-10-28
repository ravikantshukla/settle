/**
 * `npm run db:seed`: create demo invoices in the PayPal SANDBOX (routed to SANDBOX_BUYER_EMAIL).
 * Skips with a message if PayPal / sandbox emails aren't configured; you can seed later with
 * "Load demo data" in the app (DEMO_MODE=true).
 */
import "../scripts/load-env";
import { clock } from "../src/lib/clock";
import { prisma } from "../src/lib/db";
import { demoSeedConfigError, seedDemo } from "../src/lib/demo/seed";

async function main() {
  const configError = demoSeedConfigError();
  if (configError) {
    console.log(`Skipping demo seed: ${configError}\nFill in .env, then run \`npm run db:seed\` or click "Load demo data" in the app.`);
    return;
  }
  const existing = await prisma.invoice.count();
  if (existing > 0) {
    console.log(`Database already has ${existing} invoice(s); not seeding. Use "Reset demo" in the app (DEMO_MODE=true) to start over.`);
    return;
  }
  await clock.reset();
  console.log("Creating demo invoices in the PayPal sandbox…");
  const r = await seedDemo();
  for (const c of r.created) console.log(`  ✓ ${c.number}  ${c.status}  ${c.paypalInvoiceId}`);
  for (const e of r.errors) console.log(`  ✗ ${e.key}: ${e.error}`);
  if (r.errors.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
