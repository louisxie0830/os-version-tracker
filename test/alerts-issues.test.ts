import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { reportDataQuality, reportSourceStatus, resetAlertState } from '../src/alerts.js';

const realFetch = globalThis.fetch;
const realError = console.error;
const realInfo = console.info;

interface Call { method: string; path: string; body?: Record<string, unknown> }
let calls: Call[];
let openIssues: Array<{ number: number; title: string }>;
let failCreate: boolean;

beforeEach(() => {
  resetAlertState();
  calls = [];
  openIssues = [];
  failCreate = false;
  Object.assign(process.env, { ALERT_GITHUB_ISSUES: '1', GITHUB_TOKEN: 't0ken', GITHUB_REPOSITORY: 'owner/repo' });
  console.error = () => {};
  console.info = () => {};
  // A tiny fake of the three GitHub issue endpoints the alerts use
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname + new URL(String(url)).search;
    const call: Call = { method: init?.method ?? 'GET', path, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    if (call.method === 'GET') return Response.json(openIssues);
    if (call.method === 'POST' && path === '/repos/owner/repo/issues') {
      if (failCreate) return new Response('nope', { status: 500 });
      openIssues.push({ number: 7, title: String(call.body?.title) });
      return Response.json({ number: 7 }, { status: 201 });
    }
    if (call.method === 'PATCH') openIssues = openIssues.filter(i => !path.endsWith(`/${i.number}`));
    return Response.json({});
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
  console.info = realInfo;
  for (const k of ['ALERT_GITHUB_ISSUES', 'GITHUB_TOKEN', 'GITHUB_REPOSITORY']) delete process.env[k];
});

test('a failing source opens one issue, and recovery comments on and closes it', async () => {
  await reportSourceStatus('playPolicy', true);
  assert.equal(calls.length, 0, 'healthy baseline is silent');

  await reportSourceStatus('playPolicy', false, 'table not found');
  const created = calls.find(c => c.method === 'POST' && c.path === '/repos/owner/repo/issues');
  assert.equal(created?.body?.title, '[資料來源失敗] playPolicy');
  assert.match(String(created?.body?.body), /table not found/);

  calls = [];
  await reportSourceStatus('playPolicy', false, 'table not found');
  assert.equal(calls.length, 0, 'still failing: nothing new');

  await reportSourceStatus('playPolicy', true);
  assert.ok(calls.some(c => c.method === 'POST' && c.path === '/repos/owner/repo/issues/7/comments'));
  assert.deepEqual(calls.find(c => c.method === 'PATCH')?.body, { state: 'closed', state_reason: 'completed' });
});

test('an issue that already exists is reused, and a failed create is retried next time', async () => {
  openIssues = [{ number: 3, title: '[資料來源失敗] agpJdk' }];
  await reportSourceStatus('agpJdk', false, 'x');
  assert.ok(!calls.some(c => c.method === 'POST'), 'no duplicate issue');

  failCreate = true;
  await reportSourceStatus('osShare', false, 'down');
  failCreate = false;
  calls = [];
  await reportSourceStatus('osShare', false, 'down');
  assert.ok(calls.some(c => c.method === 'POST' && c.path === '/repos/owner/repo/issues'), 'retried');
});

test('without ALERT_GITHUB_ISSUES no GitHub calls are made', async () => {
  delete process.env.ALERT_GITHUB_ISSUES;
  await reportSourceStatus('osShare', false, 'down');
  assert.equal(calls.length, 0);
});

test('incomplete data opens its own [資料不完整] issue, separate from the source alert, and closes once complete', async () => {
  await reportDataQuality('twBanks', []);
  assert.equal(calls.length, 0, 'complete baseline is silent');

  await reportDataQuality('twBanks', ['android.updated 有 1/26 個 App 缺值：com.example.bank', 'twBanks.apps：筆數從 26 掉到 9']);
  const created = calls.find(c => c.method === 'POST' && c.path === '/repos/owner/repo/issues');
  assert.equal(created?.body?.title, '[資料不完整] twBanks');
  assert.match(String(created?.body?.body), /抓取成功，但資料不完整/);
  assert.match(String(created?.body?.body), /^- android\.updated 有 1\/26 個 App 缺值：com\.example\.bank$/m);
  assert.match(String(created?.body?.body), /^- twBanks\.apps：筆數從 26 掉到 9$/m);

  // The source itself is healthy all along: its own alert stays quiet
  calls = [];
  await reportSourceStatus('twBanks', true);
  assert.equal(calls.length, 0);

  await reportDataQuality('twBanks', []);
  assert.ok(calls.some(c => c.method === 'POST' && c.path === '/repos/owner/repo/issues/7/comments' && /資料完整/.test(String(c.body?.body))));
  assert.ok(calls.some(c => c.method === 'PATCH'));
});
