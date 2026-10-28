import { NextResponse } from "next/server";
import { syncOpenInvoices } from "@/lib/invoices/syncFromPayPal";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Pull the latest status of all open invoices from PayPal (works without a public webhook URL). */
export async function POST() {
  try {
    return NextResponse.json(await syncOpenInvoices());
  } catch (e) {
    console.error("sync failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sync failed" }, { status: 500 });
  }
}
