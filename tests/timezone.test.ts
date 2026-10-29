import { describe, expect, it } from "vitest";
import { describeSendTiming, isValidTimeZone, nextSendWindow, zoneAbbreviation } from "@/lib/timezone";

const at = (iso: string) => new Date(iso);

describe("nextSendWindow (weekdays 9:00–18:00 client time)", () => {
  it("sends immediately inside business hours", () => {
    const now = at("2026-10-28T15:00:00Z"); // Wed 11:00 in New York (EDT)
    expect(nextSendWindow(now, "America/New_York")).toEqual(now);
  });

  it("waits for 9:00 the same day when it's early morning there", () => {
    // Wed 06:30 in New York -> Wed 09:00 EDT = 13:00Z
    expect(nextSendWindow(at("2026-10-28T10:30:00Z"), "America/New_York").toISOString()).toBe("2026-10-28T13:00:00.000Z");
  });

  it("rolls to the next morning after 18:00", () => {
    // Wed 19:00 in London (GMT, after the Oct 25 change) -> Thu 09:00 GMT
    expect(nextSendWindow(at("2026-10-28T19:00:00Z"), "Europe/London").toISOString()).toBe("2026-10-29T09:00:00.000Z");
  });

  it("skips weekends", () => {
    // Fri 20:00 in San Francisco (PDT) -> Mon 09:00 PST (DST ends Sun Nov 1) = 17:00Z
    expect(nextSendWindow(at("2026-10-31T03:00:00Z"), "America/Los_Angeles").toISOString()).toBe("2026-11-02T17:00:00.000Z");
  });

  it("handles the DST switch: 9:00 local is right on both sides", () => {
    // Sat Oct 24 London (BST) -> Mon Oct 26 09:00, now GMT
    expect(nextSendWindow(at("2026-10-24T12:00:00Z"), "Europe/London").toISOString()).toBe("2026-10-26T09:00:00.000Z");
  });

  it("works for half-hour offsets", () => {
    // Sun in Kolkata -> Mon 09:00 IST = 03:30Z
    expect(nextSendWindow(at("2026-11-01T06:00:00Z"), "Asia/Kolkata").toISOString()).toBe("2026-11-02T03:30:00.000Z");
  });
});

describe("describeSendTiming", () => {
  it("shows client time and the freelancer's time (IST)", () => {
    // Wed 06:30 New York; window opens 09:00 EDT = 18:30 IST
    const t = describeSendTiming(at("2026-10-28T10:30:00Z"), "America/New_York", "Asia/Kolkata");
    expect(t).toMatchObject({ immediate: false, at: "2026-10-28T13:00:00.000Z" });
    expect(t.text).toBe("Sends at 9:00 AM client time (6:30 PM IST)");
  });

  it("names the day when it isn't today", () => {
    const t = describeSendTiming(at("2026-10-31T03:00:00Z"), "America/Los_Angeles", "Asia/Kolkata");
    expect(t.text).toBe("Sends at Mon 9:00 AM client time (Mon 10:30 PM IST)");
  });

  it("sends right away when the client's timezone is unknown", () => {
    const now = at("2026-10-28T10:30:00Z");
    expect(describeSendTiming(now, null, "Asia/Kolkata")).toMatchObject({ immediate: true, at: now.toISOString() });
  });
});

it("validates IANA names and abbreviates zones", () => {
  expect(isValidTimeZone("Europe/London")).toBe(true);
  expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  expect(zoneAbbreviation(at("2026-07-01T12:00:00Z"), "Europe/London")).toBe("BST");
  expect(zoneAbbreviation(at("2026-07-01T12:00:00Z"), "Asia/Kolkata")).toBe("IST");
});
