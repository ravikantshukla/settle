/**
 * Smoke test for the PayPal Invoicing wrappers (sandbox).
 *
 *   npm run smoke:invoice              create + send a test invoice
 *   npm run smoke:invoice -- <id>      fetch an existing invoice and print its status
 */
import "./load-env";
import { createDraftInvoice, getInvoice, PayPalError, paidAmountOf, sendInvoice } from "../src/lib/paypal";

async function main() {
  const existingId = process.argv[2];
  if (existingId) {
    const inv = await getInvoice(existingId);
    console.log(`Invoice ${inv.id} (#${inv.detail.invoice_number})`);
    console.log(`  status:     ${inv.status}`);
    console.log(`  amount:     ${inv.amount?.value} ${inv.amount?.currency_code}`);
    console.log(`  paid:       ${paidAmountOf(inv)}`);
    console.log(`  due:        ${inv.due_amount?.value ?? "-"}`);
    console.log(`  payer view: ${inv.detail.metadata?.recipient_view_url ?? "-"}`);
    return;
  }

  const buyer = process.env.SANDBOX_BUYER_EMAIL;
  if (!buyer) throw new Error("Set SANDBOX_BUYER_EMAIL in .env (a sandbox *personal* account email)");

  const dueDate = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const draft = await createDraftInvoice({
    recipient: { email: buyer, givenName: "Sandbox", surname: "Buyer" },
    currency: "USD",
    dueDate,
    note: "Settle smoke test invoice.",
    items: [
      { name: "Website redesign — discovery", quantity: 1, unitAmount: 450 },
      { name: "Design hours", description: "Figma mockups", quantity: 6, unitAmount: 75 },
    ],
    partialPayment: { allow: true, minimumAmountDue: 200 },
  });
  console.log(`Created draft ${draft.id} (#${draft.detail.invoice_number}), status ${draft.status}`);

  const sent = await sendInvoice(draft.id, { subject: "Invoice from Settle (sandbox)" });
  console.log("Sent.");
  console.log(`  invoice id: ${draft.id}`);
  console.log(`  payer view: ${sent.payerViewUrl ?? "(not returned)"}`);
  console.log(`\nAfter paying, check status with: npm run smoke:invoice -- ${draft.id}`);
}

main().catch((err) => {
  console.error(err instanceof PayPalError ? err.toDisplayString() : err instanceof Error ? err.message : err);
  if (err instanceof PayPalError && err.raw) console.error(JSON.stringify(err.raw, null, 2));
  process.exit(1);
});
