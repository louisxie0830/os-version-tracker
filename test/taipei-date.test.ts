import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarDate, daysUntil, taipeiToday } from '../src/taipei-date.ts';

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
