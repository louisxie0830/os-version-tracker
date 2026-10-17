/**
 * Day counts for readers in Taiwan. Deadlines are calendar days ("November 1, 2026", "2026-11-01"), and
 * "N days left" must mean Taiwan's days whatever time the build runs (the morning build runs at 21:43 UTC,
 * which is already the next day in Taipei) and whichever format the date came in (ISO dates parse as UTC
 * midnight, "Month D, YYYY" as local midnight).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Taiwan has no daylight saving time: UTC+8 all year */
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Today's date in Taipei, "YYYY-MM-DD" */
export function taipeiToday(now = new Date()): string {
  const t = new Date(now.getTime() + TAIPEI_OFFSET_MS);
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** The calendar day a deadline names, "YYYY-MM-DD", whatever the format; null if it isn't a date */
export function calendarDate(date: string): string | null {
  const iso = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const d = new Date(date);
  // "November 1, 2026" parses as local midnight: its local fields are the day it names
  return Number.isNaN(d.getTime()) ? null : ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** Whole days from today (Taipei) to the deadline's day: 0 on the day, 1 the day before, negative after */
export function daysUntil(date: string, now = new Date()): number | null {
  const day = calendarDate(date);
  if (!day) return null;
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${taipeiToday(now)}T00:00:00Z`)) / DAY_MS);
}
