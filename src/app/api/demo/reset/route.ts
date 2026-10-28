import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { clearAll, seedDemo } from "@/lib/demo/seed";

export const runtime = "nodejs";

/** Wipe ALL data and reseed the demo. Only available when DEMO_MODE=true. */
export async function POST() {
  if (process.env.DEMO_MODE !== "true") {
    return NextResponse.json({ error: "Reset is disabled. Set DEMO_MODE=true to enable it." }, { status: 403 });
  }
  try {
    await clearAll(prisma);
    await seedDemo(prisma);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("demo reset failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Reset failed" }, { status: 500 });
  }
}
