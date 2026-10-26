import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAtomFeed,
  buildNotificationsJson,
  deferNotifications,
  FORGET_AFTER_DAYS,
  recentItems,
  shownDate,
  toTrackedItems,
  flushNotifications,
  notifyWebhook,
  recordItems,
  resetChangesState,
  setNotifyRetryDelays,
  type TrackedItem,
} from '../src/changes.ts';

const item = (id: string): TrackedItem => ({
  id, kind: 'deadline', platform: 'Android', title: `Item ${id}`, detail: '', url: `https://example.com/${id}`, date: '2027-01-27',
});

const realFetch = globalThis.fetch;
let calls: string[] = [];

function mockFetch(statuses: number[]): void {
  calls = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)).text);
    const status = statuses.shift() ?? 200;
    return new Response(null, { status });
  }) as typeof fetch;
}

beforeEach(() => {
  resetChangesState();
  setNotifyRetryDelays([0, 0]);
  process.env.NOTIFY_WEBHOOK_URL = 'https://hooks.example.com/x';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.NOTIFY_WEBHOOK_URL;
});

test('the first refresh is a baseline and announces nothing', () => {
  const { added } = recordItems([item('a'), item('b')]);
  assert.deepEqual(added, []);
  const second = recordItems([item('a'), item('b'), item('c')]);
  assert.deepEqual(second.added.map(i => i.id), ['c']);
});

test('retries 429 / 5xx within a refresh and succeeds', async () => {
  mockFetch([429, 500, 200]);
  await notifyWebhook([item('a')], 'https://site');
  assert.equal(calls.length, 3);
});

test('keeps undelivered items and sends them with the next refresh', async () => {
  mockFetch([503, 503, 503]);
  await notifyWebhook([item('a')], 'https://site');
  assert.equal(calls.length, 3, 'gave up after the in-refresh retries');

  mockFetch([200]);
  await notifyWebhook([item('b')], 'https://site');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /2 項新的規定/);
  assert.match(calls[0], /Item a/);
  assert.match(calls[0], /Item b/);

  mockFetch([200]);
  await notifyWebhook([], 'https://site');
  assert.equal(calls.length, 0, 'nothing pending after a successful delivery');
});

test('does not retry permanent rejections (4xx other than 429)', async () => {
  mockFetch([400]);
  await notifyWebhook([item('a')], 'https://site');
  assert.equal(calls.length, 1);
  mockFetch([200]);
  await notifyWebhook([], 'https://site');
  assert.equal(calls.length, 0, 'rejected items are dropped, not resent forever');
});

test('network errors count as temporary failures', async () => {
  calls = [];
  globalThis.fetch = (async () => { calls.push('x'); throw new Error('ECONNRESET'); }) as typeof fetch;
  await notifyWebhook([item('a')], 'https://site');
  assert.equal(calls.length, 3);
  mockFetch([200]);
  await notifyWebhook([], 'https://site');
  assert.equal(calls.length, 1, 'retried on the next refresh');
  await flushNotifications();
});

test('a GitHub issue keeps its author through the feed, notifications and Atom', () => {
  const items = toTrackedItems({
    deadlines: [], appleNews: [], androidNews: [], devices: [],
    crashes: [{ platform: 'iOS', source: 'GitHub', kind: 'reported', title: 'Crash on iOS 27 & launch', context: 'firebase/firebase-ios-sdk', url: 'https://github.com/firebase/firebase-ios-sdk/issues/1', date: '2026-10-01', reactions: 12, comments: 3, newOs: true, author: { name: 'octocat', url: 'https://github.com/octocat' } }],
  });
  const crash = items.find(i => i.kind === 'crash')!;
  assert.deepEqual(crash.author, { name: 'octocat', url: 'https://github.com/octocat' });
  const notif = JSON.parse(buildNotificationsJson([crash], '2026-10-02T00:00:00Z')).items[0];
  assert.deepEqual(notif.author, { name: 'octocat', url: 'https://github.com/octocat' });
  const atom = buildAtomFeed([crash], 'https://site.example', '2026-10-02T00:00:00Z');
  assert.match(atom, /<entry>[\s\S]*<author><name>octocat<\/name><uri>https:\/\/github\.com\/octocat<\/uri><\/author>\n  <\/entry>/);
  assert.match(atom, /<rights>[^<]*各資料來源[^<]*\/legal\/<\/rights>/);
  assert.match(atom, /<link rel="related" href="https:\/\/site\.example\/legal\/"/);
});

test('pruning forgets only items long gone: one still listed, or seen recently, stays known', () => {
  const t0 = new Date('2024-01-01T00:00:00Z');
  recordItems([item('old-gone'), item('old-listed')], t0); // baseline
  recordItems([item('old-gone'), item('old-listed'), item('recent-gone')], new Date('2025-12-01T00:00:00Z'));
  const later = new Date(t0.getTime() + (FORGET_AFTER_DAYS + 1) * 86_400_000);
  recordItems([item('old-listed')], later, { prune: false });
  assert.deepEqual(recordItems([item('old-gone'), item('old-listed')], later).added, [], 'without pruning nothing is forgotten');
  recordItems([item('old-listed')], later, { prune: true });
  const back = recordItems([item('old-gone'), item('old-listed'), item('recent-gone')], later);
  assert.deepEqual(back.added.map(i => i.id), ['old-gone'], 'only the item gone for over two years is new again');
});

test('deferred items go out with the next notification', async () => {
  mockFetch([200, 200]);
  recordItems([item('a')]); // baseline
  const { added } = recordItems([item('a'), item('b')]);
  deferNotifications(added);
  assert.equal(calls.length, 0, 'nothing sent yet');
  await notifyWebhook([item('c')], 'https://site.example');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /Item b/);
  assert.match(calls[0], /Item c/);
  assert.match(calls[0], /2 項新的/);
});

test('recentItems: within 7 days of first seen, or (news without one) of publishing; an old post seen late is not new', () => {
  const now = new Date('2026-10-26T12:00:00Z');
  const at = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const DAY = 86_400_000;
  const news = (id: string, date: string, firstSeen?: string): TrackedItem => ({ ...item(id), kind: 'dev-news', date, firstSeen });
  const items: TrackedItem[] = [
    news('edge', '2026-10-19', at(7 * DAY)),
    news('just-past', '2026-10-19', at(7 * DAY + 1)),
    { ...item('deadline'), date: '2026-10-25' },
    news('future', '2026-10-27'),
    news('fresh-post', '2026-10-24'),
    news('backfilled', '2026-09-15', at(DAY)),
    { ...item('bank'), kind: 'bank', date: '2026-09-01', firstSeen: at(2 * DAY) },
  ];
  assert.deepEqual(recentItems(items, 7, now).map(i => i.id), ['bank', 'fresh-post', 'edge'],
    'newest first; a deadline without first-seen, a future date and a September post seen yesterday are out; a bank change counts from when it was seen');
  const yearEnd = new Date('2027-01-03T00:00:00Z');
  assert.deepEqual(recentItems([news('dec', '2026-12-28')], 7, yearEnd).map(i => i.id), ['dec'], 'across the year boundary');
});

test('shownDate: published kinds show their publish date; others when the site first saw them', () => {
  assert.equal(shownDate({ ...item('n'), kind: 'dev-news', date: '2026-09-15', firstSeen: '2026-10-21T00:00:00Z' }), '2026-09-15');
  assert.equal(shownDate({ ...item('b'), kind: 'bank', date: '2026-10-20', firstSeen: '2026-10-21T03:00:00Z' }), '2026-10-21T03:00:00Z');
  assert.equal(shownDate({ ...item('d'), date: '2027-01-27' }), '', 'a deadline never seen: no date to sort by');
});

test('the first refresh is a baseline: no first-seen times, and so nothing in it counts as new', () => {
  const now = new Date('2026-10-26T00:00:00Z');
  const { items, added } = recordItems([{ ...item('a'), kind: 'dev-news', date: '2026-10-25' }, item('d')], now);
  assert.deepEqual(added, []);
  assert.deepEqual(items.map(i => i.firstSeen), [undefined, undefined]);
  assert.deepEqual(recentItems(items, 7, now).map(i => i.id), ['a'], 'only by its own publish date; the deadline not at all');
});

test('the feed dates baseline items no later than the baseline, and a post no later than it was seen', () => {
  const t0 = new Date('2026-10-01T00:00:00Z');
  recordItems([{ ...item('future'), date: '2027-01-27' }], t0);
  const later = '2026-10-26T00:00:00.000Z';
  const feed = buildAtomFeed([{ ...item('future'), date: '2027-01-27' }], 'https://site.example', later);
  assert.match(feed, /<updated>2026-10-01T00:00:00\.000Z<\/updated>/, 'the baseline time, not this build\'s');
  const seen = '2026-10-20T00:00:00.000Z';
  const post = buildAtomFeed([{ ...item('p'), kind: 'dev-news', date: '2026-10-25', firstSeen: seen }], 'https://site.example', later);
  assert.match(post, new RegExp(`<published>${seen.replace(/\./g, '\\.')}</published>`), 'a publish date after it was seen is not believed');
  assert.equal(shownDate({ ...item('n'), kind: 'dev-news', date: '', firstSeen: seen }), seen, 'no readable date: when it was seen');
});

test('items queued while a send is in flight are kept for the next one, not overwritten when it finishes', async () => {
  let release!: () => void;
  calls = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)).text);
    await new Promise<void>(resolve => { release = resolve; });
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  const sending = notifyWebhook([item('a')], 'https://site');
  await new Promise(resolve => setImmediate(resolve));
  deferNotifications([item('b')]);
  release();
  await sending;
  mockFetch([200]);
  await notifyWebhook([], 'https://site');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /Item b/);
  assert.doesNotMatch(calls[0], /Item a/, 'the delivered one is not sent again');
});

test('deadlines announced by month or year carry it into notifications.json, the feed and the webhook text', async () => {
  const { toTrackedItems, dueLabel } = await import('../src/changes.ts');
  const tracked = toTrackedItems({ deadlines: [
    { platform: 'iOS', date: '2027-04-01', title: 'M', detail: 'x（Apple 只公布月份：2027 年 4 月起）', source: 'S', url: 'https://example.com/m' },
    { platform: 'Android', date: '2027-01-01', title: 'Y', detail: 'x（Google 只公布年份：2027 年）', source: 'S', url: 'https://example.com/y' },
    { platform: 'Android', date: '2027-02-03', title: 'D', detail: 'exact', source: 'S', url: 'https://example.com/d' },
  ], appleNews: [], androidNews: [], devices: [] } as never);
  assert.deepEqual(tracked.map(t => t.datePrecision), ['month', 'year', undefined]);
  assert.deepEqual(tracked.map(dueLabel), ['2027-04（月份）', '2027 年內', '2027-02-03']);
  const json = JSON.parse(buildNotificationsJson(tracked, '2026-10-26T00:00:00Z'));
  assert.deepEqual(json.items.map((i: { title: string; datePrecision?: string }) => [i.title, i.datePrecision]), [['Y', 'year'], ['D', undefined], ['M', 'month']]);
  assert.match(buildAtomFeed(tracked, 'https://site', '2026-10-26T00:00:00Z'), /\[iOS\] 2027-04（月份） M/);
});
