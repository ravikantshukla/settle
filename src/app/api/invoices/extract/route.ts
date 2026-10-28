import { NextResponse } from "next/server";
import { z } from "zod";
import { extractInvoice } from "@/lib/ai/extractInvoice";
import { AiToolError } from "@/lib/ai/tools";
import { rateLimited } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ text: z.string().min(1).max(100_000) });

const FRIENDLY: Record<AiToolError["kind"], string> = {
  timeout: "The AI took too long (over 30 seconds).",
  rate_limited: "The AI service is busy right now.",
  unavailable: "The AI is unavailable right now.",
  not_configured: "The AI isn't configured on this server.",
  refused: "The AI declined to process this text.",
  invalid: "The AI couldn't produce a valid draft from this text.",
};

export async function POST(req: Request) {
  const limited = rateLimited(req);
  if (limited) return limited;

  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Paste an agreement or email thread (max 100k characters)." }, { status: 400 });
  }

  try {
    return NextResponse.json({ extraction: await extractInvoice(body.data.text) });
  } catch (e) {
    const err = e instanceof AiToolError ? e : null;
    if (!err) console.error("extract failed", e);
    else if (err.detail) console.warn("extract failed:", err.kind, err.detail);
    // Graceful fallback: the UI offers a blank form to fill in by hand.
    return NextResponse.json(
      { error: `${err ? FRIENDLY[err.kind] : "Something went wrong."} You can fill in the invoice manually instead.`, fallback: "manual" },
      { status: err?.kind === "refused" || err?.kind === "invalid" ? 422 : 503 },
    );
  }
}
