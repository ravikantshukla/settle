import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness + readiness for Render. Reports which integrations are configured, never their values. */
export async function GET() {
  let db: "ok" | "error" = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = "error";
  }
  const configured = (...keys: string[]) => keys.every((k) => !!process.env[k]);
  const body = {
    ok: db === "ok",
    db,
    paypal: configured("PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET") ? (process.env.PAYPAL_API_BASE?.includes("sandbox") ? "sandbox" : "configured") : "missing",
    webhooks: configured("PAYPAL_WEBHOOK_ID") ? "configured" : "missing",
    ai: configured("ANTHROPIC_API_KEY", "ANTHROPIC_MODEL") ? "configured" : "missing",
    cron: configured("CRON_SECRET") ? "configured" : "missing",
    demoMode: process.env.DEMO_MODE === "true",
    time: new Date().toISOString(),
  };
  return NextResponse.json(body, { status: body.ok ? 200 : 503 });
}
