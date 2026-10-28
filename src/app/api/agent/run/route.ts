import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Manual "Run agent now" from the UI. */
export async function POST() {
  try {
    return NextResponse.json(await runAgent("manual"));
  } catch (e) {
    console.error("agent run failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Agent run failed" }, { status: 500 });
  }
}
