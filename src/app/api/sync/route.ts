import { NextResponse } from "next/server";
import { syncOpenInvoices } from "@/lib/invoices/syncFromPayPal";
import { syncOpenPayouts } from "@/lib/payouts/records";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Pull the latest status of open invoices and payouts from PayPal (works without a public webhook URL). */
export async function POST() {
  try {
    const invoices = await syncOpenInvoices();
    const payouts = await syncOpenPayouts();
    return NextResponse.json({ ...invoices, payouts });
  } catch (e) {
    console.error("sync failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sync failed" }, { status: 500 });
  }
}
