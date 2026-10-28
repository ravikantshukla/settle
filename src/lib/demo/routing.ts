/**
 * DEMO_MODE routing: in demo mode every invoice goes to the sandbox buyer and every subcontractor
 * payout goes to a sandbox account, so the whole flow can be completed with test accounts.
 */

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}

export class DemoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoConfigError";
  }
}

/** The email PayPal should actually send the invoice to. */
export function invoiceRecipient(extractedEmail: string): { email: string; routed: boolean } {
  if (!isDemoMode()) return { email: extractedEmail, routed: false };
  const buyer = process.env.SANDBOX_BUYER_EMAIL?.trim();
  if (!buyer) throw new DemoConfigError("DEMO_MODE is on but SANDBOX_BUYER_EMAIL is not set (see .env.example).");
  return { email: buyer, routed: buyer.toLowerCase() !== extractedEmail.trim().toLowerCase() };
}

/** Sandbox subcontractor emails for seeded demo data. */
export function sandboxSubcontractorEmails(): [string, string] {
  const a = process.env.SANDBOX_SUB1_EMAIL?.trim();
  const b = process.env.SANDBOX_SUB2_EMAIL?.trim();
  if (!a || !b) throw new DemoConfigError("Set SANDBOX_SUB1_EMAIL and SANDBOX_SUB2_EMAIL (sandbox personal accounts) for demo subcontractors.");
  return [a, b];
}

/**
 * Where a subcontractor payout actually goes. In DEMO_MODE, emails that aren't one of the sandbox
 * subcontractor accounts are routed to SUB1/SUB2 (stable per subcontractor), so payouts can succeed.
 */
export function payoutRecipient(email: string, stableKey: string): { email: string; routed: boolean } {
  if (!isDemoMode()) return { email, routed: false };
  const subs = sandboxSubcontractorEmails();
  if (subs.some((s) => s.toLowerCase() === email.trim().toLowerCase())) return { email, routed: false };
  const idx = [...stableKey].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % 2;
  return { email: subs[idx], routed: true };
}

export const ROUTED_NOTE = "demo: routed to sandbox buyer";
