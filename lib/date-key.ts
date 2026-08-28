/**
 * Pure date-key utilities ("YYYY-MM-DD") — no Prisma, no server-only
 * imports. Safe for client components.
 *
 * Timezone: "now" is read in APP_TZ (Africa/Lagos by default) via Intl, so
 * serverless UTC and local dev agree. Explicit-Date calls stay pure
 * local-calendar arithmetic (date shifting, week math, tests).
 */

/** App timezone for "now" reads. NEXT_PUBLIC so server and client agree. */
export const APP_TZ = process.env.NEXT_PUBLIC_APP_TZ ?? "Africa/Lagos";

const FMT_KEY = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const FMT_HM = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function todayKey(now?: Date): string {
  if (now === undefined) return FMT_KEY.format(new Date()); // "now" in APP_TZ
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Minutes since midnight in APP_TZ — seeds the calendar now-line. */
export function nowMinutesInAppTz(now: Date = new Date()): number {
  const [h, m] = FMT_HM.format(now).split(":").map(Number);
  return h * 60 + m;
}

export function isValidDateKey(value: string | undefined | null): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function shiftDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return todayKey(dt);
}

/** Sunday-start week containing `dateKey` (matches the calendar-table layout). */
export function weekStartKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - dt.getDay());
  return todayKey(dt);
}

/** The 7 date keys of a week given its Sunday start. */
export function weekDays(startKey: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftDateKey(startKey, i));
}

const MONTH_LONG = new Intl.DateTimeFormat("en-GB", { month: "long" });

/** Header label for a week, e.g. "August 2026" or "June – July 2026". */
export function weekLabel(startKey: string): string {
  const endKey = shiftDateKey(startKey, 6);
  const [sy, sm] = startKey.split("-").map(Number);
  const [ey, em] = endKey.split("-").map(Number);
  const startMonth = MONTH_LONG.format(new Date(sy, sm - 1, 1));
  const endMonth = MONTH_LONG.format(new Date(ey, em - 1, 1));
  if (sy === ey && sm === em) return `${startMonth} ${sy}`;
  if (sy === ey) return `${startMonth} – ${endMonth} ${sy}`;
  return `${startMonth} ${sy} – ${endMonth} ${ey}`;
}

/** 12-hour gutter label: 6 → "6 AM", 13 → "1 PM". */
export function hourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? "AM" : "PM"}`;
}

/** ISO-8601 week number of the week containing `dateKey` (1–53). */
export function isoWeekNumber(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay() || 7; // Mon=1 … Sun=7
  dt.setUTCDate(dt.getUTCDate() + 4 - dow); // shift to the week's Thursday
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return Math.ceil(((dt.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/** Sidebar label for a day: "Today" / "Yesterday" / "Thu 27 Aug". */
export function dayListLabel(dateKey: string, today: string): string {
  if (dateKey === today) return "Today";
  if (dateKey === shiftDateKey(today, -1)) return "Yesterday";
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(y, m - 1, d));
}

/** Long day label for the single-day view header: "Thursday 27 August". */
export function dayFullLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(y, m - 1, d));
}

const FMT_DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric" });
const FMT_DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/** Compact week range, e.g. "23 – 29 Aug 2026" or "29 Jun – 5 Jul 2026". */
export function weekRangeLabel(startKey: string): string {
  const endKey = shiftDateKey(startKey, 6);
  const [sy, sm, sd] = startKey.split("-").map(Number);
  const [ey, em, ed] = endKey.split("-").map(Number);
  const start = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  if (sy === ey && sm === em) return `${FMT_DAY.format(start)} – ${FMT_DAY_MONTH.format(end)} ${ey}`;
  return `${FMT_DAY_MONTH.format(start)} – ${FMT_DAY_MONTH.format(end)} ${ey}`;
}
