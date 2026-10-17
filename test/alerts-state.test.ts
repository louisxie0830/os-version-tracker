import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { exportAlertState, flushAlerts, importAlertState, reportSourceStatus, resetAlertState } from '../src/alerts.ts';

const realFetch = globalThis.fetch;
let posts: string[] = [];

function mockWebhook(): void {
  posts = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    posts.push(JSON.parse(String(init?.body)).text);
    return new Response(null, { status: 200 });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.ALERT_WEBHOOK_URL;
  resetAlertState();
});

test('a failure alerted in one build is not re-sent by the next build that restores its state', async () => {
  process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/alerts';
  mockWebhook();

  // Build 1: source fails → one FAILING alert, then the build aborts (state saved via the cache)
  await reportSourceStatus('playPolicy', false, 'table not found');
  await flushAlerts();
  assert.equal(posts.length, 1);
  assert.match(posts[0], /FAILING/);
  const saved = JSON.parse(JSON.stringify(exportAlertState()));

  // Build 2: fresh process restores the saved state; the source is still failing
  resetAlertState();
  importAlertState(saved);
  await reportSourceStatus('playPolicy', false, 'table not found');
  await flushAlerts();
  assert.equal(posts.length, 1, 'no duplicate FAILING alert');

  // Build 3: source recovers → exactly one RECOVERED message
  const saved2 = JSON.parse(JSON.stringify(exportAlertState()));
  resetAlertState();
  importAlertState(saved2);
  await reportSourceStatus('playPolicy', true);
  await flushAlerts();
  assert.equal(posts.length, 2);
  assert.match(posts[1], /RECOVERED/);
});

test('without restored state every build would alert again (the bug this guards against)', async () => {
  process.env.ALERT_WEBHOOK_URL = 'https://hooks.example.com/alerts';
  mockWebhook();
  await reportSourceStatus('playPolicy', false, 'x');
  resetAlertState();
  await reportSourceStatus('playPolicy', false, 'x');
  await flushAlerts();
  assert.equal(posts.length, 2);
});
