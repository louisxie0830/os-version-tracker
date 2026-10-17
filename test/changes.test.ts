import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAtomFeed,
  buildNotificationsJson,
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
