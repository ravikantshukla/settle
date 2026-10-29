import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";
import { cronAuthorized } from "@/lib/cronAuth";
import { refreshRiskReasons } from "@/lib/agent/risk";
import { syncOpenInvoices } from "@/lib/invoices/syncFromPayPal";
import { syncOpenPayouts } from "@/lib/payouts/records";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Scheduled run: sync with PayPal, let the agent propose actions, refresh stale risk scores.
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" $APP_BASE_URL/api/cron/agent
 */
export async function POST(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const invoices = await syncOpenInvoices();
    const payouts = await syncOpenPayouts();
    const run = await runAgent("scheduled");
    const risk = await refreshRiskReasons().catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    return NextResponse.json({ sync: { invoices, payouts }, run, risk });
  } catch (e) {
    console.error("scheduled agent run failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Run failed" }, { status: 500 });
  }
}

export const GET = POST;
