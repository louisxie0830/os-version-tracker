import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarDate, daysUntil, feedDay, taipeiToday } from '../src/taipei-date.ts';

test('taipeiToday follows Taiwan\'s date, not UTC\'s', () => {
  assert.equal(taipeiToday(new Date('2026-10-16T15:59:59Z')), '2026-10-16');
  assert.equal(taipeiToday(new Date('2026-10-16T16:00:00Z')), '2026-10-17', 'midnight in Taipei');
  assert.equal(taipeiToday(new Date('2026-12-31T16:30:00Z')), '2027-01-01');
});

test('calendarDate reads both formats as the day they name', () => {
  assert.equal(calendarDate('2026-11-01'), '2026-11-01');
  assert.equal(calendarDate('2026-11-01T00:00:00Z'), '2026-11-01');
  assert.equal(calendarDate('November 1, 2026'), '2026-11-01');
  assert.equal(calendarDate('soon'), null);
});

test('daysUntil counts whole Taiwan days: 0 on the day, negative after', () => {
  const now = new Date('2026-10-16T21:43:00Z'); // 05:43 on October 17 in Taipei
  assert.equal(daysUntil('2026-10-17', now), 0);
  assert.equal(daysUntil('October 18, 2026', now), 1);
  assert.equal(daysUntil('2026-10-16', now), -1);
  assert.equal(daysUntil('2027-01-27', now), 102);
  assert.equal(daysUntil('later', now), null);
});

test('feedDay reads the day the publisher wrote, in its own time zone, and never throws', () => {
  assert.equal(feedDay('Tue, 13 Oct 2026 17:00:00 GMT'), '2026-10-13');
  assert.equal(feedDay('Mon, 05 Oct 2026 17:05:00 PDT'), '2026-10-05', 'Apple\'s evening post: still the 5th, as Apple\'s page says');
  assert.equal(feedDay('Sun, 01 Nov 2026 17:30:00 PST'), '2026-11-01', 'after the switch to standard time');
  assert.equal(feedDay('Mon, 28 Dec 2026 23:00:00 PST'), '2026-12-28');
  assert.equal(feedDay('5 Oct 2026 10:00:00 +0000'), '2026-10-05', 'no weekday');
  assert.equal(feedDay('2026-10-13T23:30:00-07:00'), '2026-10-13');
  assert.equal(feedDay('2026-12-31T23:59:59Z'), '2026-12-31');
  assert.equal(feedDay('Thu, 32 Foo 2026 10:00:00 GMT'), null);
  assert.equal(feedDay('Mon, 32 Oct 2026 10:00:00 GMT'), null, 'no such day: null, not a thrown RangeError');
  assert.equal(feedDay('Mon, 00 Oct 2026 10:00:00 GMT'), null);
  assert.equal(feedDay('Thu, 31 Feb 2027 10:00:00 GMT'), null);
  assert.equal(feedDay('2026-10-13'), '2026-10-13', 'a bare date is kept');
  assert.equal(feedDay('not a date'), null);
  assert.equal(feedDay(undefined), null);
  assert.equal(feedDay(''), null);
});

test('calendarDate: only full dates that exist; vague phrases are not turned into exact days', () => {
  assert.equal(calendarDate('November 1, 2026'), '2026-11-01');
  assert.equal(calendarDate('Nov 1 2026'), '2026-11-01');
  assert.equal(calendarDate('Sept. 9, 2026'), '2026-09-09');
  assert.equal(calendarDate('1 November 2026'), '2026-11-01');
  assert.equal(calendarDate('2026-11-01T00:00:00Z'), '2026-11-01');
  for (const vague of ['spring 2027', 'in 2027', 'April 2027', 'December 1', '05/10/2026', 'Feb 29, 2027', '2027-02-30', 'Smarch 1, 2027', '']) {
    assert.equal(calendarDate(vague), null, vague);
  }
  assert.equal(calendarDate('Feb 29, 2028'), '2028-02-29', 'a leap day that exists');
});

test('dayOf: a timestamp\'s Taipei calendar day; a bare date unchanged', async () => {
  const { dayOf } = await import('../src/taipei-date.ts');
  assert.equal(dayOf('2026-10-15T22:37:00Z'), '2026-10-16');
  assert.equal(dayOf('2026-10-15T10:00:00Z'), '2026-10-15');
  assert.equal(dayOf('2026-10-15'), '2026-10-15');
});
