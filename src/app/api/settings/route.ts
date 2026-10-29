import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getSettings, saveSettings } from "@/lib/settings";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getSettings());
}

/** Save your name, city, timezone and negotiation limits. */
export async function PUT(req: Request) {
  try {
    return NextResponse.json(await saveSettings(await req.json().catch(() => null)));
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "Check the highlighted fields.", issues: e.issues }, { status: 400 });
    throw e;
  }
}
