import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cronAuth";
import { DemoConfigError, isDemoMode } from "@/lib/demo/routing";
import { resetDemo } from "@/lib/demo/seed";
import { rateLimited } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Cancel old sandbox invoices, wipe ALL local data, reset the clock and create fresh sandbox demo invoices.
 * Manual resets are limited to 3/hour/IP (the hosted demo is shared). The scheduled reset
 * (.github/workflows/demo-reset.yml) sends `Authorization: Bearer $CRON_SECRET` and skips the limit.
 */
export async function POST(req: Request) {
  if (!isDemoMode()) {
    return NextResponse.json({ error: "Reset is disabled. Set DEMO_MODE=true to enable it." }, { status: 403 });
  }
  if (!cronAuthorized(req)) {
    const limited = rateLimited(req, "reset");
    if (limited) return limited;
  }
  try {
    const r = await resetDemo();
    return NextResponse.json({ ok: r.seeded.errors.length === 0, ...r }, { status: r.seeded.errors.length ? 207 : 200 });
  } catch (e) {
    if (e instanceof DemoConfigError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("demo reset failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Reset failed" }, { status: 500 });
  }
}
