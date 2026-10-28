import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";
import { rateLimited } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Manual "Run agent now" from the UI. */
export async function POST(req: Request) {
  const limited = rateLimited(req);
  if (limited) return limited;
  try {
    return NextResponse.json(await runAgent("manual"));
  } catch (e) {
    console.error("agent run failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Agent run failed" }, { status: 500 });
  }
}
