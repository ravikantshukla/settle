import { NextResponse } from "next/server";
import { syncOpenInvoices } from "@/lib/invoices/syncFromPayPal";
import { syncOpenPayouts } from "@/lib/payouts/records";
import { rateLimited } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Pull the latest status of open invoices and payouts from PayPal (works without a public webhook URL). */
// Rate-limited because a newly detected payment makes the agent call Claude (payout explanation).
export async function POST(req: Request) {
  const limited = rateLimited(req);
  if (limited) return limited;
  try {
    const invoices = await syncOpenInvoices();
    const payouts = await syncOpenPayouts();
    return NextResponse.json({ ...invoices, payouts });
  } catch (e) {
    console.error("sync failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sync failed" }, { status: 500 });
  }
}
