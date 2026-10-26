import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datePrecision, lastPossibleDay, periodLabel } from '../src/deadline-dates.ts';
import { buildCalendar } from '../src/calendar.ts';
import { renderDeadlinesSection, splitDetail } from '../src/render-schedule.ts';
import { taipeiToday } from '../src/taipei-date.ts';
import type { AllVersions } from '../src/fetch-all.ts';
import type { Deadline } from '../src/types.ts';

/** Requirements announced by month or year only: shown as that period, kept until it is over, never in the calendar */
const item = (date: string, detail: string, extra: Partial<Deadline> = {}): Deadline => ({ platform: 'Android', date, title: 'T', detail, source: 'S', url: 'https://developer.android.com/', ...extra });
const YEAR = 'Google 只公布年份：2027，最早可能在年初';
const MONTH = 'Apple 只公布月份：2027 年 2 月起';
const base = { sources: {}, timeline: [], xcodeSupport: [], agpJdk: [], twBanks: [], appleDeadline: null, googleDeadline: null, androidCompat: null, ciImages: null, osShare: null, bankTrend: [], bankChanges: [] } as unknown as AllVersions;
const thisYear = Number(taipeiToday().slice(0, 4));
const thisMonth = taipeiToday().slice(0, 7);

test('datePrecision / lastPossibleDay / periodLabel', () => {
  assert.equal(datePrecision(item('2027-01-01', YEAR)), 'year');
  assert.equal(datePrecision(item('2027-02-01', MONTH)), 'month');
  assert.equal(datePrecision(item('2027-02-03', 'exact')), 'day');
  assert.equal(lastPossibleDay(item('2027-01-01', YEAR)), '2027-12-31');
  assert.equal(lastPossibleDay(item('2027-02-01', MONTH)), '2027-02-28');
  assert.equal(lastPossibleDay(item('2028-02-01', MONTH)), '2028-02-29', 'leap year');
  assert.equal(lastPossibleDay(item('2027-02-03', 'exact')), '2027-02-03');
  assert.equal(periodLabel(item('2027-01-01', YEAR)), '2027 年內');
  assert.equal(periodLabel(item('2027-02-01', MONTH)), '2027 年 2 月');
  assert.equal(periodLabel(item('2027-02-03', 'exact')), null);
});

test('timeline: a year-only date shows the year, no day count, and stays upcoming until the year is over', () => {
  const html = renderDeadlinesSection({ ...base, timeline: [item(`${thisYear}-01-01`, YEAR), item(`${thisYear + 1}-01-01`, YEAR), item(`${thisMonth}-01`, MONTH)] } as AllVersions);
  assert.match(html, new RegExp(`<div class="tl-date">${thisYear + 1} 年內</div>`));
  assert.match(html, new RegExp(`<div class="tl-date">${thisYear} 年內</div>`));
  assert.ok(!/剩 \d+ 天/.test(html), 'no countdown to a day nobody announced');
  assert.match(html, /日期未定/);
  assert.match(html, /期間內生效/);
  assert.ok(!/tl-past/.test(html), 'a period not yet over is not under the past requirements');
});

test('calendar: a year-only requirement is left out, a month-only one stays on its first day', () => {
  const ics = buildCalendar([item('2027-01-01', YEAR, { title: 'Year only' }), item('2027-02-01', MONTH, { title: 'Month only' })], 'https://example.com');
  assert.ok(!ics.includes('Year only'));
  assert.match(ics, /SUMMARY:\[Android\] Month only（2 月內，確切日期未定）/);
});

test('splitDetail: a short detail whole; a long one cut at a sentence end, else at the limit', () => {
  assert.deepEqual(splitDetail('短。'), ['短。', '']);
  const long = `${'甲'.repeat(150)}。${'乙'.repeat(300)}`;
  assert.deepEqual(splitDetail(long), [`${'甲'.repeat(150)}。`, '乙'.repeat(300)]);
  const unbroken = '丙'.repeat(400);
  assert.deepEqual(splitDetail(unbroken), ['丙'.repeat(200), '丙'.repeat(200)]);
});

test('timeline: the rest of a long detail behind 「完整說明」, past requirements collapsed at the end', () => {
  const today = taipeiToday();
  const days = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const html = renderDeadlinesSection({ ...base, timeline: [
    item(days(-30), 'Already in force.', { title: 'Past one' }),
    item(days(30), `${'甲'.repeat(150)}。${'乙'.repeat(300)}`, { title: 'Soon', extensionDate: days(90) }),
  ] } as AllVersions);
  assert.match(html, /<details class="tl-more" data-search-open><summary>完整說明<\/summary>乙+（可延長至 /);
  assert.match(html, /<details class="tl-past" data-search-open><summary>近一年已生效的規定（1 項）<\/summary>/);
  assert.ok(html.indexOf('Soon') < html.indexOf('Past one'), 'upcoming first');
  assert.ok(html.indexOf('tl-past') < html.indexOf('Past one'), 'the past one inside the collapsed list');
});

test('the published timeline says how exact each date is (additive: a day-exact item is unchanged)', async () => {
  const { buildDeadlineTimeline } = await import('../src/insights.ts');
  const at = new Date('2026-10-26T04:00:00Z');
  const timeline = buildDeadlineTimeline([item('2027-01-01', YEAR), item('2027-02-01', MONTH), item('2027-02-03', 'exact')], at);
  assert.deepEqual(timeline.map(d => d.datePrecision), ['year', 'month', undefined]);
  assert.ok(!('datePrecision' in timeline[2]));
});
