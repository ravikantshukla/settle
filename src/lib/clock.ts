/**
 * The app's clock: real time + a demo offset stored in the DB (AppSetting "clock.offsetMs").
 * ALL business date logic (due dates, aging, overdue, agent decisions, timestamps we write)
 * must use clock.now(). Only real-world timers (PayPal token expiry, request timeouts) use real time;
 * ESLint enforces this outside this file.
 */
import { prisma } from "@/lib/db";

const KEY = "clock.offsetMs";
const DAY_MS = 86_400_000;

async function offsetMs(): Promise<number> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  const n = row ? Number(row.value) : 0;
  return Number.isFinite(n) ? n : 0;
}

/** Current (possibly simulated) time. */
export async function now(): Promise<Date> {
  return new Date(Date.now() + (await offsetMs()));
}

/**
 * Map a real-world timestamp reported by PayPal (payment date, payout processed time) onto the demo
 * timeline, so events keep their order relative to simulated due dates.
 */
export async function fromReal(real: Date | string): Promise<Date> {
  return new Date(new Date(real).getTime() + (await offsetMs()));
}

export async function offsetDays(): Promise<number> {
  return Math.round((await offsetMs()) / DAY_MS);
}

/** Move the demo clock by whole days. Returns the new simulated time. */
export async function advanceDays(days: number): Promise<Date> {
  const next = (await offsetMs()) + days * DAY_MS;
  await prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: String(next) }, update: { value: String(next) } });
  return now();
}

export async function reset(): Promise<Date> {
  await prisma.appSetting.deleteMany({ where: { key: KEY } });
  return now();
}

export const clock = { now, fromReal, offsetDays, advanceDays, reset };
