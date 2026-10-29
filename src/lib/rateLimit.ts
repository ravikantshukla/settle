/**
 * In-memory rate limit for endpoints that can call Claude: 20 requests per hour per IP, shared
 * across those endpoints. Good enough for a single-instance demo; use Redis for multiple instances.
 * Real time on purpose: this is a real-world limit, not business logic.
 */
import { NextResponse } from "next/server";

export const AI_LIMIT = { max: 20, windowMs: 60 * 60 * 1000 } as const;
/** Manual "Reset demo" wipes the shared demo for everyone, so it gets a much tighter limit. */
export const RESET_LIMIT = { max: 3, windowMs: 60 * 60 * 1000 } as const;

const LIMITS = {
  ai: { ...AI_LIMIT, what: "AI requests" },
  reset: { ...RESET_LIMIT, what: "demo resets" },
} as const;

const g = globalThis as unknown as { __settleRate?: Map<string, number[]> };
const store: Map<string, number[]> = (g.__settleRate ??= new Map<string, number[]>());

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

/** Record a hit for `key`; returns ms until a slot frees up, or 0 if allowed. */
export function hit(key: string, nowMs: number, limit: { max: number; windowMs: number } = AI_LIMIT): number {
  const recent = (store.get(key) ?? []).filter((t) => nowMs - t < limit.windowMs);
  if (recent.length >= limit.max) {
    store.set(key, recent);
    return limit.windowMs - (nowMs - recent[0]);
  }
  recent.push(nowMs);
  store.set(key, recent);
  return 0;
}

export function resetRateLimits() {
  store.clear();
}

/** Returns a friendly 429 response if this request is over the limit for `bucket`, else null. */
export function rateLimited(req: Request, bucket: keyof typeof LIMITS = "ai"): NextResponse | null {
  const limit = LIMITS[bucket];
  // eslint-disable-next-line no-restricted-syntax -- real-world rate-limit window
  const waitMs = hit(`${bucket}:${clientIp(req)}`, Date.now(), limit);
  if (!waitMs) return null;
  const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
  return NextResponse.json(
    {
      error: `You've reached the demo limit of ${limit.max} ${limit.what} per hour. Please try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      retryAfterSeconds: Math.ceil(waitMs / 1000),
    },
    { status: 429, headers: { "Retry-After": String(Math.ceil(waitMs / 1000)) } },
  );
}
