import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isActive, parseDeveloperStatus } from '../src/fetchers/apple-status.ts';
import { toTrackedItems } from '../src/changes.ts';

const now = new Date('2026-10-17T12:00:00Z');
const ms = (iso: string) => new Date(iso).getTime();
const js = `jsonCallback(${JSON.stringify({
  drMessage: null,
  services: [
    { serviceName: 'App Store Connect - TestFlight', events: [{ messageId: '1', statusType: 'Issue', eventStatus: 'ongoing', epochStartDate: ms('2026-10-17T10:00:00Z'), epochEndDate: null, message: 'Apple wording, not kept' }] },
    { serviceName: 'APNS', events: [{ messageId: '2', statusType: 'Outage', eventStatus: 'resolved', epochStartDate: ms('2026-10-14T01:00:00Z'), epochEndDate: ms('2026-10-14T02:00:00Z') }] },
    { serviceName: 'Xcode Cloud', events: [{ messageId: '3', statusType: 'Issue', eventStatus: 'resolved', epochStartDate: ms('2026-09-01T01:00:00Z'), epochEndDate: ms('2026-09-01T02:00:00Z') }] },
    { serviceName: 'Account ', events: [{ messageId: '4', statusType: 'Maintenance', eventStatus: 'upcoming', epochStartDate: ms('2026-10-20T01:00:00Z'), epochEndDate: ms('2026-10-20T03:00:00Z') }] },
    { serviceName: 'Videos', events: [] },
  ],
})});`;

test('parseDeveloperStatus keeps active events and the last week, newest active first, without Apple\'s text', () => {
  const status = parseDeveloperStatus(js, now);
  assert.equal(status.services, 5);
  assert.deepEqual(status.events.map(e => [e.service, e.type, e.state]), [
    ['Account', 'Maintenance', 'upcoming'],
    ['App Store Connect - TestFlight', 'Issue', 'ongoing'],
    ['APNS', 'Outage', 'resolved'],
  ], 'a month-old event is dropped; names trimmed');
  assert.ok(!JSON.stringify(status).includes('Apple wording'));
  assert.equal(status.events[1].start, '2026-10-17T10:00:00.000Z');
  assert.equal(status.events[1].end, undefined);
});

test('isActive: not resolved and not ended', () => {
  const [upcoming, ongoing, resolved] = parseDeveloperStatus(js, now).events;
  assert.equal(isActive(upcoming, now), true);
  assert.equal(isActive(ongoing, now), true);
  assert.equal(isActive(resolved, now), false);
});

test('parseDeveloperStatus rejects a page without services', () => {
  assert.throws(() => parseDeveloperStatus('jsonCallback({"services":[]});'));
  assert.throws(() => parseDeveloperStatus('<html>maintenance</html>'));
});

test('outages and issues become feed items; planned maintenance does not', () => {
  const items = toTrackedItems({ deadlines: [], appleNews: [], androidNews: [], devices: [], appleStatus: parseDeveloperStatus(js, now) }, now);
  assert.deepEqual(items.filter(i => i.kind === 'status').map(i => i.title), ['Apple 開發者服務異常：App Store Connect - TestFlight', 'Apple 開發者服務中斷：APNS']);
});
