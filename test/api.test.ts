import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildApiFiles, legacyApiJson } from '../src/api.ts';
import type { AllVersions } from '../src/fetch-all.ts';

const snap = JSON.parse(readFileSync(new URL('./fixtures/all-versions.json', import.meta.url), 'utf8')) as AllVersions;
const SITE = 'https://site.example';

// Existing clients were built on { label, url, fetchedAt, ok } per source: fields the page uses stay out
test('api.json and api/* keep the original source shape: no staleFrom', () => {
  const data: AllVersions = {
    ...snap,
    sources: { ...snap.sources, ios: { ...snap.sources.ios, ok: false, staleFrom: '2026-10-16T00:00:00.000Z' } },
  };
  const shapes = (sources: Record<string, object>) => Object.values(sources).map(s => Object.keys(s).sort().join(','));
  const legacy = legacyApiJson(data, SITE);
  assert.ok(shapes(legacy.sources).every(k => k === 'fetchedAt,label,ok,url'));
  assert.equal(legacy.sources.ios.ok, false);
  for (const [path, body] of buildApiFiles(data, SITE)) {
    assert.doesNotMatch(body, /staleFrom/, path);
  }
  assert.equal('staleFrom' in data.sources.ios, true, 'the data itself is left as it was');
});

/** Every field api.json has always had at the top level (existing clients read these; never remove one) */
export const API_JSON_FIELDS = [
  'agpJdk', 'android', 'androidActions', 'androidCompat', 'androidNews', 'androidToolchain', 'announcedDevices', 'appleDeadline',
  'appleNews', 'appleStatus', 'attribution', 'bankChanges', 'bankTrend', 'cachedAt', 'ciImages', 'cordova', 'crashes', 'devNews',
  'frameworks', 'googleDeadline', 'ios', 'iosActions', 'iosAdoption', 'iosToolchain', 'license', 'osShare', 'privacy', 'recent',
  'security', 'sources', 'termsUrl', 'timeline', 'tracked', 'twBanks', 'xcodeSupport',
];
const full: AllVersions = { ...snap, devNews: [], cordova: null, security: null, appleStatus: null, frameworks: null, bankChanges: [], bankTrend: [] };

test('api.json: exactly the fields it has always had', () => {
  assert.deepEqual(Object.keys(legacyApiJson(full, SITE)).sort(), API_JSON_FIELDS);
});

test('api/*: the same 16 files, each in the same envelope, with the same data fields', () => {
  const files = buildApiFiles(full, SITE);
  assert.deepEqual([...files.keys()], ['api/index.json', 'api/versions.json', 'api/now.json', 'api/actions.json', 'api/deadlines.json', 'api/feed.json',
    'api/security.json', 'api/crashes.json', 'api/cordova.json', 'api/frameworks.json', 'api/compat.json', 'api/trends.json', 'api/banks.json',
    'api/news.json', 'api/status.json', 'api/privacy.json']);
  const body = (path: string) => JSON.parse(files.get(path)!);
  for (const path of [...files.keys()].slice(1)) {
    assert.deepEqual(Object.keys(body(path)).sort(), ['apiVersion', 'attribution', 'data', 'license', 'sources', 'termsUrl', 'updatedAt'], path);
  }
  const dataKeys: Record<string, string[]> = {
    'api/versions.json': ['ios', 'android', 'iosToolchain', 'androidToolchain'],
    'api/actions.json': ['ios', 'android'],
    'api/deadlines.json': ['timeline', 'appleDeadline', 'googleDeadline'],
    'api/feed.json': ['items', 'recent'],
    'api/compat.json': ['xcodeSupport', 'androidCompat', 'agpJdk', 'ciImages'],
    'api/trends.json': ['osShare', 'iosAdoption'],
    'api/banks.json': ['apps', 'changes', 'trend'],
    'api/news.json': ['items'],
  };
  for (const [path, keys] of Object.entries(dataKeys)) assert.deepEqual(Object.keys(body(path).data), keys, path);
  for (const path of ['api/frameworks.json', 'api/status.json', 'api/cordova.json', 'api/security.json']) {
    assert.ok('data' in body(path) && body(path).data === null, `${path}: data is null, never left out`);
  }
  const index = body('api/index.json');
  assert.deepEqual(Object.keys(index).sort(), ['apiVersion', 'endpoints', 'envelope', 'license', 'sources', 'sourcesRegister', 'termsUrl', 'updatedAt']);
  for (const e of index.endpoints) assert.deepEqual(Object.keys(e), ['path', 'url', 'description']);
});

test('api/cordova.json: each package\'s advisories, and whether its latest version is still affected', () => {
  const advisory = { id: 'GHSA-x', cve: 'CVE-1', severity: 'high', url: 'https://github.com/advisories/GHSA-x', summary: 's', published: '2026-10-01',
    ranges: [{ package: 'cordova-android', vulnerable: '< 14.0.2', patched: '14.0.2' }, { package: 'other', vulnerable: '< 1', patched: '1' }] };
  const cordova = (latest: string) => ({ platforms: [{ name: 'cordova-android', latest }], plugins: [] });
  const cordovaData = (latest: string, security: unknown) => JSON.parse(buildApiFiles({ ...full, cordova: cordova(latest), security } as unknown as AllVersions, SITE).get('api/cordova.json')!).data;
  assert.deepEqual(cordovaData('14.0.1', { advisories: [advisory] }).advisories, [
    { package: 'cordova-android', id: 'GHSA-x', cve: 'CVE-1', severity: 'high', vulnerable: '< 14.0.2', patched: '14.0.2', latestAffected: true, url: advisory.url },
  ]);
  assert.equal(cordovaData('14.0.2', { advisories: [advisory] }).advisories[0].latestAffected, false);
  assert.deepEqual(cordovaData('14.0.1', null).advisories, []);
});

test('the page states the refresh cadence readers can count on', async () => {
  const { renderHTML } = await import('../src/render.ts');
  assert.match(renderHTML(snap, { refreshMinutes: 12 * 60 }), /官方來源每天約 2 次自動更新/);
  assert.match(renderHTML(snap, { refreshMinutes: 10 }), /每 10 分鐘自動更新/);
});
