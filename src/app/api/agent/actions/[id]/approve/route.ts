import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ActionStateError, executeAction } from "@/lib/agent";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Approve (optionally with edits: { subject?, message?, minimumAmount? }) and execute. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { edits?: unknown };
  try {
    const result = await executeAction(id, body.edits);
    return NextResponse.json(result, { status: result.status === "EXECUTED" ? 200 : 502 });
  } catch (e) {
    if (e instanceof ActionStateError) return NextResponse.json({ error: e.message }, { status: 409 });
    if (e instanceof ZodError) return NextResponse.json({ error: "Invalid edits", issues: e.issues }, { status: 400 });
    console.error("approve failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Approval failed" }, { status: 500 });
  }
}
