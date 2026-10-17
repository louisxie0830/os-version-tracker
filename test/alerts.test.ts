import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { reportSourceStatus, resetAlertState } from '../src/alerts.js';

const WEBHOOK = 'https://hooks.example.com/services/T000/B000/XXX';
const realFetch = globalThis.fetch;
const realError = console.error;
const realInfo = console.info;

let calls: Array<{ url: string; init?: RequestInit; text: string }>;
let respond: () => Promise<Response>;

beforeEach(() => {
  resetAlertState();
  calls = [];
  respond = async () => new Response('ok', { status: 200 });
  process.env.ALERT_WEBHOOK_URL = WEBHOOK;
  console.error = () => {};
  console.info = () => {};
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init, text: JSON.parse(String(init?.body)).text });
    return respond();
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
  console.info = realInfo;
  delete process.env.ALERT_WEBHOOK_URL;
});

test('alerts only on transitions: first failure, then recovery', async () => {
  await reportSourceStatus('xcodeSupport', true);
  await reportSourceStatus('xcodeSupport', true);
  assert.equal(calls.length, 0, 'healthy baseline is silent');

  await reportSourceStatus('xcodeSupport', false, 'Xcode support table not found');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, WEBHOOK);
  assert.equal(calls[0].init?.method, 'POST');
  assert.equal((calls[0].init?.headers as Record<string, string>)['Content-Type'], 'application/json');
  assert.match(calls[0].text, /FAILING: source "xcodeSupport".*Xcode support table not found/);

  await reportSourceStatus('xcodeSupport', false, 'Xcode support table not found');
  await reportSourceStatus('xcodeSupport', false, 'Xcode support table not found');
  assert.equal(calls.length, 1, 'no repeat alerts while still failing');

  await reportSourceStatus('xcodeSupport', true);
  assert.equal(calls.length, 2);
  assert.match(calls[1].text, /RECOVERED: source "xcodeSupport"/);

  await reportSourceStatus('xcodeSupport', true);
  assert.equal(calls.length, 2);
});

test('sources are tracked independently; a failure on the very first refresh alerts', async () => {
  await reportSourceStatus('playPolicy', false, 'boom');
  await reportSourceStatus('pageSize', true);
  await reportSourceStatus('pageSize', false, 'No 16 KB page size deadline found');
  await reportSourceStatus('playPolicy', false, 'boom');
  assert.deepEqual(calls.map(c => c.text.match(/source "(\w+)"/)?.[1]), ['playPolicy', 'pageSize']);
});

test('a failed webhook delivery is retried on the next report, and never throws', async () => {
  respond = async () => { throw new Error('network down'); };
  await assert.doesNotReject(reportSourceStatus('adoption', false, 'charts not found'));
  assert.equal(calls.length, 1);

  respond = async () => new Response('nope', { status: 500 });
  await reportSourceStatus('adoption', false, 'charts not found');
  assert.equal(calls.length, 2, 'retried after the network error');

  respond = async () => new Response('ok', { status: 200 });
  await reportSourceStatus('adoption', false, 'charts not found');
  assert.equal(calls.length, 3, 'retried after the HTTP 500');

  await reportSourceStatus('adoption', false, 'charts not found');
  assert.equal(calls.length, 3, 'delivered, so no more alerts');
});

test('recovery is not announced if the failure alert was never delivered', async () => {
  respond = async () => new Response('nope', { status: 500 });
  await reportSourceStatus('kotlin', false, 'x');
  await reportSourceStatus('kotlin', true);
  assert.equal(calls.length, 1);
});

test('without ALERT_WEBHOOK_URL nothing is sent, failures are still logged', async () => {
  delete process.env.ALERT_WEBHOOK_URL;
  const logged: string[] = [];
  console.error = (msg: string) => { logged.push(msg); };
  await reportSourceStatus('ios', false, 'timeout');
  await reportSourceStatus('ios', false, 'timeout');
  await reportSourceStatus('ios', true);
  assert.equal(calls.length, 0);
  assert.equal(logged.length, 2);
  assert.match(logged[0], /\[ios\] failed \(timeout\)/);
  assert.match(logged[1], /2 in a row/);
});
