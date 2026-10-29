/**
 * Client-timezone helpers. Pure functions (no I/O); callers pass `now` from clock.now().
 *
 * Reminders go out in the client's business hours: weekdays, 9:00–18:00 in their timezone.
 */

export const SEND_WINDOW = { startHour: 9, endHour: 18 } as const;

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function zonedParts(date: Date, tz: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: WEEKDAYS.indexOf(get("weekday")),
  };
}

/** Offset of `tz` from UTC at `date`, in ms (e.g. +19_800_000 for Asia/Kolkata). */
function offsetMs(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(date.getTime() / 60_000) * 60_000;
}

/** The instant when the wall clock in `tz` reads year-month-day hour:00. DST-safe (two passes). */
function zonedTime(year: number, month: number, day: number, hour: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour);
  let t = guess - offsetMs(new Date(guess), tz);
  t = guess - offsetMs(new Date(t), tz);
  return new Date(t);
}

const isWeekday = (weekday: number) => weekday >= 1 && weekday <= 5;

export function inSendWindow(at: Date, tz: string): boolean {
  const p = zonedParts(at, tz);
  return isWeekday(p.weekday) && p.hour >= SEND_WINDOW.startHour && p.hour < SEND_WINDOW.endHour;
}

/** `now` if it's already inside the client's weekday 9:00–18:00, else the next 9:00 on a weekday there. */
export function nextSendWindow(now: Date, tz: string): Date {
  if (inSendWindow(now, tz)) return now;
  const p = zonedParts(now, tz);
  // Start from today 9:00 if it's still early, otherwise tomorrow; then skip weekends.
  let { year, month, day } = p;
  let weekday = p.weekday;
  const advance = () => {
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    year = next.getUTCFullYear();
    month = next.getUTCMonth() + 1;
    day = next.getUTCDate();
    weekday = (weekday + 1) % 7;
  };
  if (p.hour >= SEND_WINDOW.startHour) advance();
  while (!isWeekday(weekday)) advance();
  return zonedTime(year, month, day, SEND_WINDOW.startHour, tz);
}

/** Short zone name, preferring letters ("EST", "BST", "IST") over "GMT+5:30". */
export function zoneAbbreviation(at: Date, tz: string): string {
  let fallback = "";
  for (const locale of ["en-US", "en-GB", "en-IN"]) {
    const name = new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
    if (name && !/^(GMT|UTC)[+-]/.test(name)) return name;
    fallback ||= name;
  }
  return fallback || tz;
}

/** "10:00 AM", or "Mon 9:00 AM" when it's not the same calendar day as `now` in that zone. */
export function formatZoned(at: Date, tz: string, now: Date): string {
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(at);
  const a = zonedParts(at, tz);
  const n = zonedParts(now, tz);
  const sameDay = a.year === n.year && a.month === n.month && a.day === n.day;
  return sameDay ? time : `${WEEKDAYS[a.weekday]} ${time}`;
}

export interface SendTiming {
  /** ISO instant the message will go out (demo-clock time). */
  at: string;
  immediate: boolean;
  /** e.g. "Sends at 10:00 AM client time (8:30 PM IST)" */
  text: string;
}

/** When an approved client-facing message would be sent, described for the approver. */
export function describeSendTiming(now: Date, clientTz: string | null | undefined, myTz: string): SendTiming {
  if (!isValidTimeZone(clientTz)) {
    return { at: now.toISOString(), immediate: true, text: "Sends as soon as you approve (client timezone unknown; set it on the invoice)" };
  }
  const at = nextSendWindow(now, clientTz);
  const immediate = at.getTime() === now.getTime();
  const when = describeInstant(at, now, clientTz, myTz);
  return {
    at: at.toISOString(),
    immediate,
    text: immediate ? `Sends now: it's ${when}, inside their business hours` : `Sends at ${when}`,
  };
}

/** "9:00 AM client time (6:30 PM IST)" for a given instant. */
export function describeInstant(at: Date, now: Date, clientTz: string, myTz: string): string {
  const mine = isValidTimeZone(myTz) ? ` (${formatZoned(at, myTz, now)} ${zoneAbbreviation(at, myTz)})` : "";
  return `${formatZoned(at, clientTz, now)} client time${mine}`;
}
