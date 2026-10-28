import { NextResponse } from "next/server";
import { ActionStateError, rejectAction } from "@/lib/agent";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { reason?: string };
  try {
    await rejectAction(id, typeof body.reason === "string" ? body.reason.slice(0, 500) : undefined);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ActionStateError) return NextResponse.json({ error: e.message }, { status: 409 });
    console.error("reject failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Reject failed" }, { status: 500 });
  }
}
