import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";
import { refreshRiskReasons } from "@/lib/agent/risk";
import { syncOpenInvoices } from "@/lib/invoices/syncFromPayPal";
import { syncOpenPayouts } from "@/lib/payouts/records";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Scheduled run: sync with PayPal, let the agent propose actions, refresh stale risk scores.
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" $APP_BASE_URL/api/cron/agent
 */
export async function POST(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
