import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lastRefreshDiagnostics, REFRESH_DEPS, refreshAllVersions, SITE_URL, SOURCES, type AllVersions, type RefreshDeps } from '../src/fetch-all.ts';
import { publishDecision } from '../src/publish-health.ts';
import { resetHistoryState } from '../src/history.ts';
import { ITEM_SOURCES, resetChangesState } from '../src/changes.ts';
import { resetLastGood } from '../src/last-good.ts';
import type { TaiwanBankApp } from '../src/fetchers/tw-banks.ts';

/**
 * Whole refreshes with every source, the clock, alerts, notifications and history replaced: no network,
 * no state files. The source data comes from a real snapshot (test/fixtures/all-versions.json).
 */
const snap = JSON.parse(readFileSync(new URL('./fixtures/all-versions.json', import.meta.url), 'utf8')) as AllVersions;
const NOW = new Date('2026-10-17T03:00:00.000Z');

/** Bank names as the stores return them, before masking */
const RAW_BANKS: TaiwanBankApp[] = snap.twBanks.map((b, i) => ({ ...b, bank: `測試原名商業銀行${i}`, app: `測試原名行動銀行${i}`, ios: b.ios && { ...b.ios, url: `https://apps.apple.com/tw/app/測試原名行動銀行${i}/id${100 + i}` } }));

// The snapshot predates the Cordova crash list
const CRASHES = { ...snap.crashes!, cordova: snap.crashes!.cordova ?? [] };

const devNews = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `n${i}`, source: 'Swift.org', platform: 'iOS' as const, category: 'language' as const, title: `News ${i}`, url: `https://swift.org/blog/${i}`, date: '2026-10-10', important: false }));

type Fetchers = RefreshDeps['fetchers'];
function fakeFetchers(): Fetchers {
  return {
    ios: async () => snap.ios,
    android: async () => snap.android,
    appleDeadline: async () => snap.appleDeadline,
    googleDeadline: async () => snap.googleDeadline,
    iosToolchain: async () => ({ ...snap.iosToolchain!, releases: [], knowniPhones: [] }),
    androidToolchain: async () => snap.androidToolchain!,
    adoption: async () => snap.iosAdoption!,
    appleNews: async () => snap.appleNews,
    androidNews: async () => snap.androidNews,
    androidCompat: async () => snap.androidCompat!,
    xcodeSupport: async () => snap.xcodeSupport,
    appleRequirements: async () => [],
    playPolicy: async () => [],
    playBilling: async () => ({ deadlines: [], latest: undefined }),
    pageSize: async () => [],
    ciImages: async () => snap.ciImages!,
    agpJdk: async () => snap.agpJdk,
    privacy: async () => snap.privacy!,
    osShare: async () => snap.osShare!,
    twBanks: async () => RAW_BANKS,
    devNews: async () => devNews(10),
    cordova: async () => ({ platforms: [], plugins: [] }) as never,
    security: async () => null as never,
    appleStatus: async () => ({ services: 1, events: [], url: 'https://developer.apple.com/system-status/' }),
    frameworks: async () => ({}),
    sdkReleases: async () => [],
    behaviorChanges: async () => null,
    appleDeprecations: async () => [],
    crashes: async () => CRASHES,
  };
}

/** Records every call that leaves the refresh */
function harness(fetchers: Partial<Fetchers> = {}, extra: Partial<Omit<RefreshDeps, 'fetchers'>> = {}) {
  const calls = {
    status: [] as Array<{ key: string; ok: boolean; detail?: string }>,
    quality: [] as Array<{ source: string; problems: string[] }>,
    banks: [] as TaiwanBankApp[][],
    notified: [] as Array<{ added: unknown[]; siteUrl: string }>,
    scopes: { begun: 0, ended: 0 },
  };
  const deps = {
    fetchers: { ...fakeFetchers(), ...fetchers },
    now: () => NOW,
    reportSourceStatus: async (key: string, ok: boolean, detail?: string) => { calls.status.push({ key, ok, detail }); },
    reportDataQuality: async (source: string, problems: string[]) => { calls.quality.push({ source, problems }); },
    recordBankVersions: (apps: TaiwanBankApp[]) => { calls.banks.push(apps); return []; },
    bankSnapshots: () => [],
    notifyWebhook: async (added: unknown[], siteUrl: string) => { calls.notified.push({ added, siteUrl }); },
    beginFeedScope: () => { calls.scopes.begun++; return () => { calls.scopes.ended++; }; },
    ...extra,
  } satisfies Partial<Omit<RefreshDeps, 'fetchers'>> & { fetchers: Fetchers };
  return { calls, run: () => refreshAllVersions(deps) };
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  resetHistoryState();
  resetChangesState();
  resetLastGood();
  // Nothing here may reach the network: any real fetcher left in would fail loudly
  globalThis.fetch = (async (url: string) => { throw new Error(`unexpected network request: ${url}`); }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

test('the fakes replace every production source (so no test refresh can reach the network)', () => {
  assert.deepEqual(Object.keys(fakeFetchers()).sort(), Object.keys(REFRESH_DEPS.fetchers).sort());
  assert.deepEqual(Object.keys(REFRESH_DEPS.fetchers).sort(), Object.keys(SOURCES).sort(), 'one fetcher per published source');
});

test('all sources succeed: every source ok, no errors, the data assembled and publishable', async () => {
  const { calls, run } = harness();
  const data = await run();
  assert.equal(Object.keys(data.sources).length, Object.keys(SOURCES).length);
  assert.ok(Object.values(data.sources).every(s => s.ok), 'every source ok');
  assert.deepEqual(lastRefreshDiagnostics().errors, {});
  assert.equal(publishDecision(data.sources).publish, true);
  assert.deepEqual(data.ios, snap.ios);
  assert.equal(data.iosToolchain?.xcodeStable?.version, snap.iosToolchain?.xcodeStable?.version);
  assert.equal('releases' in (data.iosToolchain ?? {}), false, 'the full Xcode history is not served');
  assert.ok(data.iosActions.length > 0 && data.androidActions.length > 0, 'actions derived from the versions');
  assert.equal(calls.status.length, Object.keys(SOURCES).length);
  assert.ok(calls.status.every(s => s.ok));
  // api.json is this object at its top level: a refresh never drops one of its fields (test/api.test.ts)
  assert.deepEqual(Object.keys(data).sort(), ['agpJdk', 'android', 'androidActions', 'androidCompat', 'androidNews', 'androidToolchain', 'announcedDevices',
    'appleDeadline', 'appleNews', 'appleStatus', 'bankChanges', 'bankTrend', 'cachedAt', 'ciImages', 'cordova', 'crashes', 'devNews', 'frameworks',
    'googleDeadline', 'ios', 'iosActions', 'iosAdoption', 'iosToolchain', 'osShare', 'privacy', 'recent', 'security', 'sources', 'timeline', 'tracked',
    'twBanks', 'xcodeSupport']);
});

test('non-critical sources failing: their fallbacks are used, the errors recorded and alerted, and it still publishes', async () => {
  const { calls, run } = harness({
    cordova: async () => { throw new Error('HTTP 503: registry.npmjs.org/cordova-ios/latest'); },
    playBilling: async () => { throw new Error('Timed out after 15s: developer.android.com/google/play/billing/deprecation-faq'); },
    osShare: async () => { throw new Error('StatCounter ios/TW failed: 403'); },
  });
  const data = await run();
  assert.equal(data.cordova, null);
  assert.equal(data.osShare, null);
  assert.ok(Array.isArray(data.timeline), 'the billing fallback ({ deadlines: [] }) keeps the timeline working');
  for (const key of ['cordova', 'playBilling', 'osShare'] as const) {
    assert.equal(data.sources[key].ok, false, key);
    assert.ok(lastRefreshDiagnostics().errors[key], `${key}: reason kept for the run summary`);
    assert.ok(calls.status.some(s => s.key === key && !s.ok && s.detail === lastRefreshDiagnostics().errors[key]), `${key}: alerted`);
  }
  assert.equal(data.sources.ios.ok, true);
  assert.equal(publishDecision(data.sources).publish, true);
});

test('iOS or Android failing: empty data and a refusal to publish', async () => {
  for (const key of ['ios', 'android'] as const) {
    resetLastGood();
    const { run } = harness({ [key]: async () => { throw new Error(`${key} down`); } });
    const data = await run();
    assert.deepEqual(data[key], []);
    assert.equal(data.sources[key].ok, false);
    assert.equal(lastRefreshDiagnostics().errors[key], `${key} down`);
    assert.equal(publishDecision(data.sources).publish, false, `${key} is critical`);
  }
});

test('a failed source shows its last good result, marked stale, and iOS / Android that way still publish', async () => {
  const LATER = new Date(NOW.getTime() + 12 * 60 * 60 * 1000);
  await harness().run(); // every source good: remembered
  const { calls, run } = harness({
    ios: async () => { throw new Error('ios down'); },
    cordova: async () => { throw new Error('HTTP 503'); },
  }, { now: () => LATER });
  const data = await run();
  assert.deepEqual(data.ios, snap.ios, 'the last good iOS versions');
  assert.equal(data.sources.ios.ok, false);
  assert.equal(data.sources.ios.staleFrom, NOW.toISOString());
  assert.equal(data.sources.ios.fetchedAt, LATER.toISOString(), 'fetchedAt is still when this refresh tried');
  assert.deepEqual(data.cordova, { platforms: [], plugins: [] });
  assert.match(lastRefreshDiagnostics().errors.ios ?? '', /ios down（沿用 .* UTC 的資料）/);
  assert.ok(calls.status.some(s => s.key === 'ios' && !s.ok && s.detail === 'ios down'), 'still alerted');
  const decision = publishDecision(data.sources);
  assert.equal(decision.publish, true, 'stale iOS is still a page worth publishing');
  assert.deepEqual(decision.stale.sort(), ['cordova', 'ios']);
});

test('a source that takes longer than its deadline fails without holding up the rest', async () => {
  const { run } = harness({ cordova: () => new Promise(() => {}) }, { sourceDeadlineMs: () => 20 });
  const data = await run();
  assert.equal(data.sources.cordova.ok, false);
  assert.match(lastRefreshDiagnostics().errors.cordova ?? '', /gave up after/);
  assert.equal(data.sources.ios.ok, true);
});

test('a saved result of another kind (from an older build) is not used: the empty fallback is', async () => {
  const { calls, run } = harness({ devNews: async () => { throw new Error('down'); } }, {
    lastGood: (<T>() => ({ fetchedAt: NOW.toISOString(), value: { not: 'a list' } as unknown as T })) as RefreshDeps['lastGood'],
  });
  const data = await run();
  assert.deepEqual(data.devNews, []);
  assert.equal(data.sources.devNews.staleFrom, undefined);
  assert.ok(calls.status.some(s => s.key === 'devNews' && !s.ok));
});

test('notifications follow the injected publish gate (the server shows every refresh)', async () => {
  await harness().run(); // baseline
  const extra = [...devNews(10), { ...devNews(1)[0], id: 'fresh2', title: 'New', important: true }];
  resetLastGood();
  const { calls, run } = harness({ devNews: async () => extra, ios: async () => { throw new Error('down'); } }, { willPublish: () => true });
  await run();
  assert.equal(calls.notified.length, 1, 'sent although the static build wouldn\'t publish this refresh');
});

test('a core version that went back is replaced by the last good one (not published), and stays out of the publish gate', async () => {
  await harness().run(); // remembers iOS as it is now
  const good = snap.ios.find(v => !v.isBeta)!.version;
  const { run } = harness({ ios: async () => [{ platform: 'iOS', version: '18.7', releaseDate: '2025-01-01' }] }, {
    coreVersionProblems: () => [{ source: 'ios', message: 'iOS stable went back' }],
  });
  const data = await run();
  assert.equal(data.ios.find(v => !v.isBeta)?.version, good, 'the rejected 18.7 is never published');
  assert.equal(data.sources.ios.ok, false);
  assert.ok(data.sources.ios.staleFrom);
  const androidBack = harness({}, { coreVersionProblems: () => [{ source: 'android', message: 'went back' }] });
  const a = await androidBack.run();
  assert.deepEqual(a.android, snap.android, 'Android the same way');
  assert.ok(a.sources.android.staleFrom);
});

test('seen items are forgotten only for the sources that answered this time', async () => {
  const prunes: Array<(id: string) => boolean> = [];
  const recordItems = ((items: unknown[], _now: Date, opts?: { prune?: (id: string) => boolean }) => { prunes.push(opts!.prune!); return { items, added: [] }; }) as unknown as RefreshDeps['recordItems'];
  await harness({ devNews: async () => { throw new Error('down'); } }, { recordItems }).run();
  const [prunable] = prunes;
  assert.equal(prunable('dev-news:https://swift.org/x'), false, 'its source failed: kept');
  assert.equal(prunable('crash:https://github.com/x/1'), true, 'another source answered: may go');
  assert.equal(prunable('device:iPhone Duo'), true);
  assert.equal(prunable('mystery:1'), false, 'an unknown kind is never forgotten');
});

test('a last good result older than a week is not used', async () => {
  await harness().run();
  const { run } = harness({ cordova: async () => { throw new Error('HTTP 503'); } }, { now: () => new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000) });
  const data = await run();
  assert.equal(data.cordova, null);
  assert.equal(data.sources.cordova.staleFrom, undefined);
});

test('a list that shrank shows its last good result until the drop persists', async () => {
  await harness().run(); // 10 developer news items
  const { calls, run } = harness({ devNews: async () => devNews(2) });
  const data = await run();
  assert.equal(data.devNews.length, 10, 'the previous, complete list');
  assert.equal(data.sources.devNews.ok, false);
  assert.ok(data.sources.devNews.staleFrom);
  assert.ok(calls.quality.some(q => q.source === 'devNews' && q.problems.length === 1), 'the drop is still alerted');
});

test('new items are notified only with a refresh that will be published', async () => {
  const deferred: unknown[][] = [];
  await harness().run(); // baseline
  const extraNews = [...devNews(10), { ...devNews(1)[0], id: 'fresh', title: 'Brand new', important: true }];
  const { calls, run } = harness({ devNews: async () => extraNews, ios: async () => { throw new Error('down'); } }, { deferNotifications: added => { deferred.push(added); } });
  resetLastGood(); // iOS has nothing to fall back on: not publishable
  await run();
  assert.equal(calls.notified.length, 0);
  assert.equal(deferred.length, 1);
});

test('core version rollback guard: an older Xcode than last time marks the toolchain failed and leaves it out', async () => {
  await harness().run(); // accepts Xcode 27.0 as the baseline
  const older = { ...snap.iosToolchain!.xcodeStable!, version: '26.4', notesUrl: 'https://example.com/old' };
  let crashContext: unknown;
  const { calls, run } = harness({
    iosToolchain: async () => ({ ...snap.iosToolchain!, xcodeStable: older, releases: [], knowniPhones: [] }),
    crashes: async context => { crashContext = context; return CRASHES; },
  });
  const data = await run();
  assert.equal(data.iosToolchain?.xcodeStable?.version, snap.iosToolchain!.xcodeStable!.version, 'the implausible toolchain is not published: the last good one stands in');
  assert.equal(data.sources.iosToolchain.ok, false);
  assert.equal(data.sources.iosToolchain.staleFrom, NOW.toISOString());
  assert.match(lastRefreshDiagnostics().errors.iosToolchain ?? '', /Xcode/);
  assert.ok(calls.status.some(s => s.key === 'iosToolchain' && !s.ok));
  assert.notEqual((crashContext as { xcodeNotesUrl?: string }).xcodeNotesUrl, older.notesUrl, 'crash notes do not follow the rejected Xcode');
  // With no last good result, the rejected toolchain is left out
  resetLastGood();
  const again = await run();
  assert.equal(again.iosToolchain, null);
  assert.equal(again.sources.iosToolchain.staleFrom, undefined);
  assert.equal(data.sources.ios.ok, true, 'the other sources are unaffected');
});

test('the crash fetcher runs only after the core versions are in, and gets them', async () => {
  let versionsDone = 0;
  let seenWhenCrashesStarted = -1;
  let crashContext: Record<string, unknown> = {};
  const late = <T>(value: T) => async () => { await new Promise(r => setTimeout(r, 15)); versionsDone++; return value; };
  const { run } = harness({
    ios: late(snap.ios),
    android: late(snap.android),
    iosToolchain: late({ ...snap.iosToolchain!, releases: [], knowniPhones: [] }),
    crashes: async context => { seenWhenCrashesStarted = versionsDone; crashContext = context; return CRASHES; },
  });
  const data = await run();
  assert.equal(seenWhenCrashesStarted, 3, 'iOS, Android and the toolchain had all finished');
  assert.deepEqual(crashContext, {
    iosMajor: snap.ios.find(v => !v.isBeta)!.version.match(/^\d+/)![0],
    androidMajor: snap.android.find(v => !v.isBeta)!.version.match(/\d+/)![0],
    xcodeNotesUrl: snap.iosToolchain!.xcodeStable!.notesUrl,
  });
  assert.equal(data.sources.crashes.ok, true);
});

test('quality diagnostics: a list source that suddenly returns far fewer items is reported, and the data still published', async () => {
  await harness().run(); // 10 developer news items: the baseline
  resetLastGood(); // nothing to fall back on
  const { calls, run } = harness({ devNews: async () => devNews(2) });
  const data = await run();
  const problems = lastRefreshDiagnostics().quality.devNews ?? [];
  assert.equal(problems.length, 1);
  assert.match(problems[0], /devNews\.items/);
  assert.ok(calls.quality.some(q => q.source === 'devNews' && q.problems.length === 1), 'quality alert raised');
  assert.equal(data.sources.devNews.ok, true, 'still a working source');
  assert.equal(data.devNews.length, 2, 'the short list is all there is'); 
  assert.equal(lastRefreshDiagnostics().counts.devNews?.['devNews.items'], 2);
  // A source that failed is not checked for completeness (its empty fallback would look like a drop)
  const failed = harness({ devNews: async () => { throw new Error('down'); } });
  await failed.run();
  assert.equal(lastRefreshDiagnostics().quality.devNews, undefined);
  assert.ok(!failed.calls.quality.some(q => q.source === 'devNews'));
});

test('tracked items: the first refresh is a silent baseline; a later new item is notified once, with the site URL', async () => {
  const first = harness();
  const data = await first.run();
  assert.ok(data.tracked.length > 0, 'deadlines, news and devices are tracked');
  assert.deepEqual(first.calls.notified, [{ added: [], siteUrl: SITE_URL }], 'baseline: nothing is announced');

  const news = { title: 'Upcoming requirement', url: 'https://developer.apple.com/news/?id=new1', date: '2026-10-16', important: true };
  const second = harness({ appleNews: async () => [news, ...snap.appleNews] });
  const next = await second.run();
  const added = second.calls.notified[0].added as Array<{ id: string; firstSeen?: string }>;
  assert.deepEqual(added.map(a => a.id), [`apple-news:${news.url}`], 'only the new item');
  assert.equal(added[0].firstSeen, NOW.toISOString(), 'first seen at the injected time');
  assert.ok(next.recent.some(r => r.id === added[0].id), 'and listed as recent');

  const third = harness({ appleNews: async () => [news, ...snap.appleNews] });
  await third.run();
  assert.deepEqual(third.calls.notified[0].added, [], 'never announced twice');
});

test('the feed scope is closed after a refresh, and after one that throws', async () => {
  const ok = harness();
  await ok.run();
  assert.deepEqual(ok.calls.scopes, { begun: 1, ended: 1 });

  const failing = harness({}, { recordItems: () => { throw new Error('state broken'); } });
  await assert.rejects(failing.run(), /state broken/);
  assert.deepEqual(failing.calls.scopes, { begun: 1, ended: 1 });
});

test('bank data is masked before it is stored, published or notified: the raw names appear nowhere', async () => {
  const { calls, run } = harness();
  const data = await run();
  const leaks = (value: unknown) => /測試原名/.test(JSON.stringify(value));
  assert.equal(data.twBanks.length, RAW_BANKS.length);
  assert.ok(!leaks(data), 'not in the published data');
  assert.equal(calls.banks.length, 1);
  assert.ok(!leaks(calls.banks), 'not in the history state');
  assert.ok(!leaks(calls.notified), 'not in notifications');
  assert.match(data.twBanks[0].bank, /^測○+行0$/, 'first and last characters kept');
  assert.equal(data.twBanks[0].ios?.url, 'https://apps.apple.com/tw/app/id100', 'the app name is dropped from App Store links');
});

test('cachedAt and every source\'s fetchedAt come from the injected clock', async () => {
  const data = await harness().run();
  assert.equal(data.cachedAt, NOW.toISOString());
  assert.ok(Object.values(data.sources).every(s => s.fetchedAt === NOW.toISOString()));
  // Failed sources and rollback-rejected ones too
  const failed = await harness({ cordova: async () => { throw new Error('x'); } }).run();
  assert.equal(failed.sources.cordova.fetchedAt, NOW.toISOString());
});

test('every kind of tracked item names real sources to answer for it', async () => {
  for (const [kind, sources] of Object.entries(ITEM_SOURCES)) {
    for (const source of sources) assert.ok(source in SOURCES, `${kind}: ${source}`);
  }
  const data = await harness().run();
  for (const item of data.tracked) assert.ok(item.id.slice(0, item.id.indexOf(':')) in ITEM_SOURCES, item.id);
});
