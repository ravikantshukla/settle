import { NextResponse } from "next/server";
import { refreshRiskReasons } from "@/lib/agent/risk";
import { rateLimited } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Re-score open invoices whose facts changed since their last score. */
export async function POST(req: Request) {
  const limited = rateLimited(req);
  if (limited) return limited;
  try {
    return NextResponse.json(await refreshRiskReasons());
  } catch (e) {
    console.error("risk refresh failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Risk refresh failed" }, { status: 500 });
  }
}
