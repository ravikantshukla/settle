import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { extractInvoice, ExtractionError } from "@/lib/ai/extractInvoice";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({ text: z.string().min(1).max(100_000) });

export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Paste an agreement or email thread (max 100k characters)." }, { status: 400 });
  }

  try {
    return NextResponse.json({ extraction: await extractInvoice(body.data.text) });
  } catch (e) {
    if (e instanceof ExtractionError) {
      return NextResponse.json({ error: e.message, detail: e.detail }, { status: 422 });
    }
    if (e instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "The AI is rate limited. Wait a moment and retry." }, { status: 429 });
    }
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `AI request failed (${e.status}): ${e.message}` }, { status: 502 });
    }
    console.error("extract failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Extraction failed" }, { status: 500 });
  }
}
