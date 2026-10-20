import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPLE_REQUIREMENTS_URL,
  PLAY_POLICY_FALLBACK_URL,
  PLAY_POLICY_URL,
  fetchPlayPolicyDeadlines,
  parseAppleRequirements,
  parseMavenLatest,
  parsePageSizeDeadlines,
  parsePlayBilling,
  parsePlayPolicyDeadlines,
} from '../src/fetchers/requirements.js';
import { fixture, GARBAGE_HTML } from './helpers.js';
import { setRetryDelay } from '../src/net.js';

test('parseAppleRequirements: upcoming requirements with dates', () => {
  const items = parseAppleRequirements(fixture('apple-upcoming-requirements.html'));
  const target = items.find(i => /must target iOS 13/.test(i.detail));
  assert.ok(target, 'iOS 13 minimum target requirement present');
  assert.equal(target.date, '2026-09-09');
  assert.equal(target.title, 'iOS and iPadOS minimum system requirements');
  assert.equal(target.platform, 'iOS');
  assert.ok(target.url.startsWith(APPLE_REQUIREMENTS_URL));

  const sdk = items.find(i => i.title === 'SDK minimum requirements');
  assert.equal(sdk?.date, '2026-04-28');
  assert.match(sdk?.detail ?? '', /Xcode 26 or later/);
  for (const i of items) assert.match(i.date, /^\d{4}-\d{2}-\d{2}$/);
});

test('parsePlayPolicyDeadlines: policy deadline table', () => {
  const items = parsePlayPolicyDeadlines(fixture('play-policy-deadlines.html'));
  assert.ok(items.length >= 5);
  const contacts = items.find(i => /Contacts Permissions policy/.test(i.detail));
  assert.equal(contacts?.date, '2027-01-27');
  assert.equal(contacts?.title, 'Play 政策：Permissions and APIs that Access Sensitive Information');
  const console = items.find(i => i.title === 'Play 政策：Play Console Requirements');
  assert.equal(console?.date, '2026-09-30');
  for (const i of items) {
    assert.equal(i.platform, 'Android');
    assert.doesNotMatch(i.detail, /Announced \d{4}/);
  }
});

test('parsePlayBilling: deprecation dates, extensions and latest version from maven-metadata', () => {
  const { deadlines, latest } = parsePlayBilling(fixture('play-billing-deprecation.html'), fixture('billing-maven-metadata.xml'));
  assert.equal(latest, '9.1.0');
  const pbl7 = deadlines.find(d => d.title === 'Play Billing Library 7 停止支援');
  assert.equal(pbl7?.date, '2026-08-31');
  assert.equal(pbl7?.extensionDate, '2026-11-01');
  assert.match(pbl7?.detail ?? '', /最新版本為 9\.1\.0/);
  assert.equal(deadlines.find(d => d.title.includes('Library 8'))?.date, '2027-08-31');
});

test('parsePlayBilling: missing metadata only drops `latest`', () => {
  const { deadlines, latest } = parsePlayBilling(fixture('play-billing-deprecation.html'), '');
  assert.equal(latest, undefined);
  assert.ok(deadlines.length >= 3);
  assert.doesNotMatch(deadlines[0].detail, /最新版本/);
});

test('parseMavenLatest picks the last stable x.y.z version', () => {
  assert.equal(parseMavenLatest('<versions><version>8.0.0</version><version>9.0.0-rc01</version><version>9.1.0</version></versions>'), '9.1.0');
  assert.equal(parseMavenLatest(''), undefined);
});

test('parsePageSizeDeadlines: 16 KB page size deadline', () => {
  const items = parsePageSizeDeadlines(fixture('page-sizes.html'));
  assert.equal(items[0].date, '2027-02-01');
  assert.match(items[0].detail, /^Starting February 1, 2027, if your app updates don't support 16 KB/);
});

test('requirements parsers throw on an unrecognised page layout', () => {
  assert.throws(() => parseAppleRequirements(GARBAGE_HTML), /No Apple requirements/);
  assert.throws(() => parsePlayPolicyDeadlines(GARBAGE_HTML), /Play policy deadline table/);
  assert.throws(() => parsePlayBilling(GARBAGE_HTML, fixture('billing-maven-metadata.xml')), /Play Billing deprecation table/);
  assert.throws(() => parsePageSizeDeadlines(GARBAGE_HTML), /16 KB/);
});

test('table parsers throw when the header survives but no row parses', () => {
  assert.throws(
    () => parsePlayPolicyDeadlines('<table><tr><th>Deadline</th><th>Policy change</th></tr><tr><td>Soon</td><td>TBD</td></tr></table>'),
    /parsed empty/,
  );
  assert.throws(
    () => parsePlayBilling('<table><tr><th>Version</th><th>Deadline</th><th>Extension deadline</th></tr><tr><td>7</td><td>TBD</td><td></td></tr></table>'),
    /parsed empty/,
  );
});

test('Play policy: a 429 on the primary locale tries the official en-GB page', async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  setRetryDelay(0);
  try {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      urls.push(u);
      return u === PLAY_POLICY_FALLBACK_URL
        ? new Response(fixture('play-policy-deadlines.html'))
        : new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } });
    }) as typeof fetch;
    const items = await fetchPlayPolicyDeadlines();
    assert.ok(items.length >= 5);
    assert.deepEqual(urls, [PLAY_POLICY_URL, PLAY_POLICY_URL, PLAY_POLICY_FALLBACK_URL]);
  } finally {
    globalThis.fetch = original;
    setRetryDelay(1500);
  }
});

test('Play policy: if both official locales are throttled the source still reports failure', async () => {
  const original = globalThis.fetch;
  setRetryDelay(0);
  try {
    globalThis.fetch = (async () => new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } })) as typeof fetch;
    await assert.rejects(fetchPlayPolicyDeadlines(), /429/);
  } finally {
    globalThis.fetch = original;
    setRetryDelay(1500);
  }
});
