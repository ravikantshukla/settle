import { NextResponse } from "next/server";
import { z } from "zod";
import { clock } from "@/lib/clock";
import { isDemoMode } from "@/lib/demo/routing";

export const runtime = "nodejs";

const Body = z.union([z.object({ advanceDays: z.number().int().min(-365).max(365) }), z.object({ reset: z.literal(true) })]);

/** Demo clock: { advanceDays: n } or { reset: true }. DEMO_MODE only. */
export async function POST(req: Request) {
  if (!isDemoMode()) return NextResponse.json({ error: "The demo clock is only available when DEMO_MODE=true." }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send { advanceDays: number } or { reset: true }." }, { status: 400 });
  const now = "reset" in parsed.data ? await clock.reset() : await clock.advanceDays(parsed.data.advanceDays);
  return NextResponse.json({ now: now.toISOString(), offsetDays: await clock.offsetDays() });
}
