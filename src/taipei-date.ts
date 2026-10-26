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

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "YYYY-MM-DD" for a day that exists (no February 30th), else null */
function realDay(y: number, m: number, d: number): string | null {
  if (!(m >= 1 && m <= 12 && d >= 1 && y >= 2000 && y <= 2099)) return null;
  const day = ymd(y, m, d);
  const t = Date.parse(`${day}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(day) ? day : null;
}

/**
 * The calendar day a deadline names, "YYYY-MM-DD", or null. Only a full date counts: ISO ("2026-11-01"),
 * "November 1, 2026" / "Nov 1 2026" or "1 November 2026", with a day that exists. A vaguer phrase ("spring
 * 2027", "April 2027", "December 1" without a year, "05/10/2026") isn't turned into an exact day.
 */
export function calendarDate(date: string): string | null {
  const text = date.trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (iso) return realDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const month = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
  const mdy = text.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (mdy && month(mdy[1])) return realDay(Number(mdy[3]), month(mdy[1]), Number(mdy[2]));
  const dmy = text.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
  if (dmy && month(dmy[2])) return realDay(Number(dmy[3]), month(dmy[2]), Number(dmy[1]));
  return null;
}

/**
 * The day a feed item was published, as its publisher dated it: the calendar day written in the timestamp
 * itself, in the publisher's own time zone ("Mon, 05 Oct 2026 17:05:00 PDT" is October 5, as Apple's page
 * says, not the 6th it already is in UTC; "2026-10-13T23:30:00-07:00" is the 13th). Use the feed's original
 * pubDate, not rss-parser's isoDate (converted to UTC). Anything else readable gives its UTC day. Null when
 * missing or unreadable (never throws, unlike toISOString on an invalid date).
 */
export function feedDay(raw: string | undefined): string | null {
  const text = raw?.trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})(?:$|T)/);
  if (iso) return Number.isNaN(Date.parse(`${iso[1]}T00:00:00Z`)) ? null : iso[1];
  const rfc = text.match(/^(?:[A-Za-z]{3},?\s+)?(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})\b/);
  const month = rfc ? MONTHS.indexOf(rfc[2].toLowerCase()) + 1 : 0;
  const day = rfc && month ? ymd(Number(rfc[3]), month, Number(rfc[1])) : null;
  if (day) {
    // "32 Oct" or "00 Oct" isn't a day (and an invalid Date's toISOString throws)
    const t = Date.parse(`${day}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().startsWith(day) ? day : null;
  }
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Whole days from today (Taipei) to the deadline's day: 0 on the day, 1 the day before, negative after */
export function daysUntil(date: string, now = new Date()): number | null {
  const day = calendarDate(date);
  if (!day) return null;
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${taipeiToday(now)}T00:00:00Z`)) / DAY_MS);
}

/** A timestamp's Taipei calendar day ("2026-10-15T22:37:00Z" → "2026-10-16"); a bare date as it is */
export function dayOf(timestamp: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(timestamp)) return timestamp;
  const at = new Date(timestamp);
  return Number.isNaN(at.getTime()) ? timestamp.slice(0, 10) : taipeiToday(at);
}
