import { NextResponse } from "next/server";
import { ActionStateError, sendScheduledAction } from "@/lib/agent";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Send an approved, scheduled message now instead of waiting for the client's business hours. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await sendScheduledAction(id, { force: true });
    return NextResponse.json(result, { status: result.status === "FAILED" ? 502 : 200 });
  } catch (e) {
    if (e instanceof ActionStateError) return NextResponse.json({ error: e.message }, { status: 409 });
    console.error("send-now failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Send failed" }, { status: 500 });
  }
}
