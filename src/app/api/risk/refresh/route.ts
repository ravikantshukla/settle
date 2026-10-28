import { NextResponse } from "next/server";
import { refreshRiskScores } from "@/lib/agent/risk";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Re-score open invoices whose facts changed since their last score. */
export async function POST() {
  try {
    return NextResponse.json(await refreshRiskScores());
  } catch (e) {
    console.error("risk refresh failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Risk refresh failed" }, { status: 500 });
  }
}
