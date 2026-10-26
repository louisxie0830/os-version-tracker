import type { Deadline, SubmissionDeadline } from './types.js';
import { calendarDate } from './taipei-date.js';

/**
 * How exact a deadline's date is. Some requirements are announced by month ("From February 2027") or by year
 * ("in 2027") only; their date is that period's first day, and the parser says so in the detail
 * ("只公布月份" / "只公布年份"). The site then shows the period, never a day count to a day nobody announced.
 */
export type DatePrecision = 'day' | 'month' | 'year';

export function datePrecision(d: Pick<Deadline, 'detail' | 'datePrecision'>): DatePrecision {
  if (d.datePrecision) return d.datePrecision;
  return /只公布年份/.test(d.detail) ? 'year' : /只公布月份/.test(d.detail) ? 'month' : 'day';
}

/** The last day the requirement could still be ahead: the period's end for a month or a year, else its own day */
export function lastPossibleDay(d: Pick<Deadline, 'date' | 'detail'>): string {
  const [y, m] = d.date.split('-').map(Number);
  const precision = datePrecision(d);
  if (precision === 'year') return `${y}-12-31`;
  if (precision === 'month') return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return d.date;
}

/**
 * The day to count urgency to: a month's first day (it may start then, and a month is close enough to plan
 * for), but a year's last (a whole year "urgent" from two months before it starts would mean nothing)
 */
export function urgencyDay(d: Pick<Deadline, 'date' | 'detail' | 'datePrecision'>): string {
  return datePrecision(d) === 'year' ? lastPossibleDay(d) : d.date;
}

/** "2027 年內" / "2027 年 2 月" for an approximate date, null for an exact one */
export function periodLabel(d: Pick<Deadline, 'date' | 'detail'>): string | null {
  const [y, m] = d.date.split('-').map(Number);
  const precision = datePrecision(d);
  return precision === 'year' ? `${y} 年內` : precision === 'month' ? `${y} 年 ${m} 月` : null;
}

/** A store's SDK deadline as a timeline-style date (null when it can't be read), its precision kept */
export function submissionDay(d: SubmissionDeadline): Pick<Deadline, 'date' | 'detail'> | null {
  const date = calendarDate(d.deadline);
  return date ? { date, detail: d.datePrecision === 'month' ? '只公布月份' : '' } : null;
}

/** The note a month-only date carries in its detail: "（Apple 只公布月份：2027 年 4 月起）" */
export function monthOnlyNote(who: string, date: string): string {
  return `（${who} 只公布月份：${Number(date.slice(0, 4))} 年 ${Number(date.slice(5, 7))} 月起）`;
}
