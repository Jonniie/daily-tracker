import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dayListLabel,
  hourLabel,
  isValidDateKey,
  isoWeekNumber,
  nowMinutesInAppTz,
  shiftDateKey,
  todayKey,
  weekDays,
  weekLabel,
  weekRangeLabel,
  weekStartKey,
} from "@/lib/date-key";

describe("date keys", () => {
  it("todayKey formats YYYY-MM-DD", () => {
    expect(todayKey(new Date(2026, 7, 27))).toBe("2026-08-27");
    expect(todayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("isValidDateKey accepts only strict keys", () => {
    expect(isValidDateKey("2026-08-27")).toBe(true);
    expect(isValidDateKey("2026-8-27")).toBe(false);
    expect(isValidDateKey("27/08/2026")).toBe(false);
    expect(isValidDateKey(undefined)).toBe(false);
  });

  it("shiftDateKey crosses month boundaries", () => {
    expect(shiftDateKey("2026-08-27", 7)).toBe("2026-09-03");
    expect(shiftDateKey("2026-08-27", -7)).toBe("2026-08-20");
    expect(shiftDateKey("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("app-timezone now reads (APP_TZ = Africa/Lagos, UTC+1)", () => {
  afterEach(() => vi.useRealTimers());

  it("todayKey() defaults to the Lagos date, not the server's", () => {
    vi.useFakeTimers();
    // 23:30 UTC is 00:30 the next day in Lagos — even on a UTC server.
    vi.setSystemTime(new Date("2026-08-28T23:30:00Z"));
    expect(todayKey()).toBe("2026-08-29");
  });

  it("nowMinutesInAppTz() is minutes since Lagos midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T08:05:00Z")); // 09:05 in Lagos
    expect(nowMinutesInAppTz()).toBe(9 * 60 + 5);
  });
});

describe("week helpers", () => {
  // 2026-08-27 is a Thursday; its Sunday-start week begins 2026-08-23.
  it("weekStartKey returns the Sunday of the containing week", () => {
    expect(weekStartKey("2026-08-27")).toBe("2026-08-23");
    expect(weekStartKey("2026-08-23")).toBe("2026-08-23"); // Sunday itself
    expect(weekStartKey("2026-08-29")).toBe("2026-08-23"); // Saturday
    expect(weekStartKey("2026-08-24")).toBe("2026-08-23"); // Monday
  });

  it("weekDays returns 7 consecutive days", () => {
    const days = weekDays("2026-08-23");
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-08-23");
    expect(days[6]).toBe("2026-08-29");
  });

  it("weekLabel handles same-month, cross-month, and cross-year weeks", () => {
    expect(weekLabel("2026-08-23")).toBe("August 2026");
    expect(weekLabel("2026-06-28")).toBe("June – July 2026"); // Sun Jun 28 – Sat Jul 4
    expect(weekLabel("2026-12-27")).toBe("December 2026 – January 2027");
  });

  it("weekRangeLabel is compact", () => {
    expect(weekRangeLabel("2026-08-23")).toBe("23 – 29 Aug 2026");
    expect(weekRangeLabel("2026-06-28")).toBe("28 Jun – 4 Jul 2026");
  });

  it("isoWeekNumber follows ISO-8601 (Thursday rule)", () => {
    expect(isoWeekNumber("2026-01-01")).toBe(1); // Thursday of ISO week 1
    expect(isoWeekNumber("2025-12-29")).toBe(1); // Monday of ISO 2026 week 1
    expect(isoWeekNumber("2026-08-27")).toBe(35);
    expect(isoWeekNumber("2026-12-31")).toBe(53); // Thursday — 2026 has 53 ISO weeks
  });
});

describe("display labels", () => {
  it("hourLabel renders 12-hour gutter text", () => {
    expect(hourLabel(6)).toBe("6 AM");
    expect(hourLabel(12)).toBe("12 PM");
    expect(hourLabel(13)).toBe("1 PM");
    expect(hourLabel(23)).toBe("11 PM");
  });

  it("dayListLabel marks Today/Yesterday, else weekday date", () => {
    const today = "2026-08-27";
    expect(dayListLabel(today, today)).toBe("Today");
    expect(dayListLabel("2026-08-26", today)).toBe("Yesterday");
    expect(dayListLabel("2026-08-20", today)).toBe("Thu 20 Aug");
  });
});
