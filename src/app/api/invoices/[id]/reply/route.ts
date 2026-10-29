import { NextResponse } from "next/server";
import { handleClientReply, ReplyError } from "@/lib/negotiation/handleReply";
import { rateLimited } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 90;

/** "Client replied": { text } -> Claude reads it, code applies your limits, a proposal goes to the inbox. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimited(req);
  if (limited) return limited;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { text?: unknown };
  try {
    return NextResponse.json(await handleClientReply(id, typeof body.text === "string" ? body.text : ""));
  } catch (e) {
    if (e instanceof ReplyError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("client reply failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't process the reply" }, { status: 500 });
  }
}
