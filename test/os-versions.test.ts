import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iOSBetaShipped, releaseDateIn, parseAppleAssetCatalog, parseBetaReleaseFeed, parseEndOfLifeiOS, parseStableReleaseFeed } from '../src/fetchers/ios.ts';
import { androidBetaShipped, parseBetaFeed, parseBetaTitle, parseEndOfLifeAndroid } from '../src/fetchers/android.ts';

// Synthetic data in the shape of each upstream (structure only)

test('parseAppleAssetCatalog picks the newest iPhone build, comparing versions numerically', () => {
  const v = parseAppleAssetCatalog({
    PublicAssetSets: { iOS: [
      { ProductVersion: '27.0.1', Build: '24A10', PostingDate: '2026-09-28', SupportedDevices: ['iPhone17,1'] },
      { ProductVersion: '27.1', Build: '24B83', PostingDate: '2026-10-12', SupportedDevices: ['iPhone17,1', 'iPad16,3'] },
      { ProductVersion: '27.10', Build: '99Z1', PostingDate: '2026-10-13', SupportedDevices: ['iPad16,3'] },
      { ProductVersion: '18.7.10', Build: '22H300', PostingDate: '2026-10-13', SupportedDevices: ['iPhone11,8'] },
    ] },
    AssetSets: {},
  });
  assert.deepEqual([v.version, v.build, v.releaseDate], ['27.1', '24B83', '2026-10-12']);
  assert.throws(() => parseAppleAssetCatalog({ PublicAssetSets: {}, AssetSets: {} }), /No iOS versions/);
});

test('parseStableReleaseFeed takes the highest stable version, not the first item', () => {
  const v = parseStableReleaseFeed([
    { title: 'iOS 18.7.10 (22H300)', pubDate: 'Tue, 13 Oct 2026 17:00:00 GMT' },
    { title: 'iOS 27.2 beta 4 (24C5050a)', pubDate: 'Tue, 13 Oct 2026 17:00:00 GMT' },
    { title: 'iOS 27.1 RC (24B80)', pubDate: 'Mon, 05 Oct 2026 17:00:00 GMT' },
    { title: 'iOS 27.1 (24B83)', pubDate: 'Mon, 12 Oct 2026 17:00:00 GMT' },
    { title: 'iPadOS 27.1 (24B83)', pubDate: 'Mon, 12 Oct 2026 17:00:00 GMT' },
    { title: 'Xcode 27.1 (17B50)', pubDate: 'Mon, 12 Oct 2026 17:00:00 GMT' },
  ]);
  assert.deepEqual([v.version, v.build, v.releaseDate], ['27.1', '24B83', '2026-10-12']);
  assert.throws(() => parseStableReleaseFeed([{ title: 'Xcode 27.1 (17B50)' }]), /No iOS stable/);
});

test('parseBetaReleaseFeed reads the newest iOS beta with its build', () => {
  const v = parseBetaReleaseFeed([
    { title: 'Xcode 27.2 beta 4 (17C5040a)', pubDate: 'Tue, 13 Oct 2026 17:00:00 GMT' },
    { title: 'iOS 27.2 beta 4 (24C5050a)', pubDate: 'Tue, 13 Oct 2026 17:00:00 GMT' },
    { title: 'iOS 27.2 beta 3 (24C5040a)', pubDate: 'Tue, 06 Oct 2026 17:00:00 GMT' },
  ]);
  assert.deepEqual([v?.version, v?.build, v?.releaseDate, v?.isBeta], ['27.2 beta 4', '24C5050a', '2026-10-13', true]);
  assert.equal(parseBetaReleaseFeed([{ title: 'iOS 27.1 (24B83)' }]), null);
});

test('parseBetaReleaseFeed reads a release candidate once it replaces the betas', () => {
  const v = parseBetaReleaseFeed([
    { title: 'Xcode 27.2 RC (27B48)', pubDate: 'Tue, 20 Oct 2026 17:00:00 GMT' },
    { title: 'iOS 27.2 RC (24B115)', pubDate: 'Tue, 20 Oct 2026 17:00:00 GMT' },
    { title: 'iOS 27.2 beta 4 (24C5050a)', pubDate: 'Tue, 13 Oct 2026 17:00:00 GMT' },
  ]);
  assert.deepEqual([v?.version, v?.build, v?.releaseDate, v?.isBeta], ['27.2 RC', '24B115', '2026-10-20', true]);
  assert.deepEqual(parseBetaReleaseFeed([{ title: 'iOS 27.2 RC 2 (24B120)' }])?.version, '27.2 RC 2');
});

test('parseEndOfLifeiOS uses the newest cycle', () => {
  assert.equal(parseEndOfLifeiOS([{ cycle: '27', releaseDate: '2026-09-14', latest: '27.1' }, { cycle: '26', releaseDate: '2025-09-15', latest: '26.7.1' }]).version, '27.1');
  assert.throws(() => parseEndOfLifeiOS([]), /No iOS versions/);
});

test('parseEndOfLifeAndroid keeps the version label, API level and codename', () => {
  const v = parseEndOfLifeAndroid([
    { cycle: '17', releaseDate: '2026-06-16', eol: false, lts: false, codename: 'Cinnamon Bun', apiVersion: '37' },
    { cycle: '16', releaseDate: '2025-06-10', eol: false, lts: false, codename: 'Baklava', apiVersion: '36' },
  ]);
  assert.deepEqual([v.version, v.apiLevel, v.codename], ['Android 17', '37', 'Cinnamon Bun']);
  assert.throws(() => parseEndOfLifeAndroid([]), /No Android versions/);
});

test('parseBetaTitle normalises ordinal, numbered, QPR and developer preview titles', () => {
  assert.equal(parseBetaTitle('The Second Beta of Android 18'), 'Android 18 Beta 2');
  assert.equal(parseBetaTitle('Android 17 QPR3 Beta 2 is now available'), 'Android 17 QPR3 Beta 2');
  assert.equal(parseBetaTitle('The first Developer Preview of Android 18'), 'Android 18 DP1');
  assert.equal(parseBetaTitle('Android 18 Developer Preview 2'), 'Android 18 DP2', 'numbered: not "DP18" from the version before it');
  assert.equal(parseBetaTitle('What is new in Kotlin'), null);
});

test('parseBetaFeed takes the newest Android beta post and ignores other posts', () => {
  const v = parseBetaFeed([
    { title: 'Jetpack Compose 1.12 is stable', isoDate: '2026-10-10T10:00:00.000Z' },
    { title: 'Android 17 QPR3 Beta 1 is now available', isoDate: '2026-10-08T10:00:00.000Z' },
    { title: 'The Second Beta of Android 17', isoDate: '2026-03-01T10:00:00.000Z' },
  ]);
  assert.deepEqual([v?.version, v?.releaseDate, v?.isBeta], ['Android 17 QPR3 Beta 1', '2026-10-08', true]);
  assert.equal(parseBetaFeed([{ title: 'Jetpack Compose 1.12 is stable' }]), null);
});

test('an iOS pre-release is dropped once its version has shipped', () => {
  const stable = { platform: 'iOS' as const, version: '27.2', releaseDate: '2026-10-27' };
  const beta = (version: string) => ({ platform: 'iOS' as const, version, releaseDate: '2026-10-20', isBeta: true });
  assert.equal(iOSBetaShipped(beta('27.2 RC'), stable), true);
  assert.equal(iOSBetaShipped(beta('27.1 beta 3'), stable), true);
  assert.equal(iOSBetaShipped(beta('27.3 beta 1'), stable), false);
  assert.equal(iOSBetaShipped(beta('27.2 RC'), { ...stable, version: '27.1.1' }), false);
  assert.equal(iOSBetaShipped(beta('27.2 RC'), null), false, 'no stable to compare with: keep it');
});

test('an Android beta is dropped once its major has shipped; a QPR beta of the current major stays', () => {
  const stable = { platform: 'Android' as const, version: 'Android 17', releaseDate: '2026-06-10' };
  const beta = (version: string) => ({ platform: 'Android' as const, version, releaseDate: '2026-10-01', isBeta: true });
  assert.equal(androidBetaShipped(beta('Android 17 Beta 4'), stable), true);
  assert.equal(androidBetaShipped(beta('Android 18 DP1'), stable), false);
  assert.equal(androidBetaShipped(beta('Android 17 QPR2 Beta 1'), stable), false);
  assert.equal(androidBetaShipped(beta('Android 16 QPR3 Beta 2'), stable), true);
  assert.equal(androidBetaShipped(beta('Android Beta'), stable), false, 'unreadable: keep it');
});

test('an unreadable feed date is "unknown" instead of an exception', () => {
  assert.equal(parseBetaReleaseFeed([{ title: 'iOS 27.2 beta 4 (24C5050a)', pubDate: 'not a date' }])?.releaseDate, 'unknown');
  assert.equal(parseStableReleaseFeed([{ title: 'iOS 27.1 (24B83)', pubDate: 'garbage' }]).releaseDate, 'unknown');
});

test('parseAppleAssetCatalog: a newer build for one new model only is not the current release', () => {
  const all = Array.from({ length: 40 }, (_, i) => `iPhone${12 + Math.floor(i / 4)},${(i % 4) + 1}`);
  const v = parseAppleAssetCatalog({
    PublicAssetSets: { iOS: [
      { ProductVersion: '27.1', Build: '24A95425', PostingDate: '2026-10-22', SupportedDevices: ['iPhone19,4'] },
      { ProductVersion: '27.0.1', Build: '24A446', PostingDate: '2026-09-28', SupportedDevices: all },
      { ProductVersion: '26.7.1', Build: '23H40', PostingDate: '2026-09-28', SupportedDevices: all.slice(0, 30) },
    ] },
    AssetSets: {},
  });
  assert.deepEqual([v.version, v.build], ['27.0.1', '24A446']);
  // Once the general release is out it covers the new model too
  const later = parseAppleAssetCatalog({ PublicAssetSets: { iOS: [
    { ProductVersion: '27.1.1', Build: '24B10', PostingDate: '2026-11-03', SupportedDevices: [...all, 'iPhone19,4'] },
    { ProductVersion: '27.0.1', Build: '24A446', PostingDate: '2026-09-28', SupportedDevices: all },
  ] }, AssetSets: {} });
  assert.equal(later.version, '27.1.1');
});

test('fetchAndroidVersions: the blog failing leaves the stable version; a beta of a shipped major is left out', async t => {
  const { fetchAndroidVersions } = await import('../src/fetchers/android.ts');
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  const warn = t.mock.method(console, 'warn', () => {});
  const eol = [{ cycle: '17', releaseDate: '2026-06-16', eol: false, lts: false, codename: 'Cinnamon Bun', apiVersion: '37' }];
  let blog: Response | Error = new Error('blog down');
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (String(url).includes('endoflife.date')) return Response.json(eol);
    if (blog instanceof Error) throw blog;
    return blog.clone();
  }) as typeof fetch;
  assert.deepEqual((await fetchAndroidVersions()).map(v => v.version), ['Android 17']);
  assert.ok(warn.mock.calls.some(c => /Beta blog feed failed/.test(String(c.arguments[0]))));

  const atom = (title: string) => new Response(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>b</title><entry><title>${title}</title><published>2026-10-01T17:00:00-07:00</published><link href="https://example.com/x"/></entry></feed>`);
  blog = atom('The Fourth Beta of Android 17');
  assert.deepEqual((await fetchAndroidVersions()).map(v => v.version), ['Android 17'], '17 has shipped: its beta is history');
  blog = atom('Android 18 Developer Preview 1');
  const next = await fetchAndroidVersions();
  assert.deepEqual(next.map(v => [v.version, v.releaseDate]), [['Android 17', '2026-06-16'], ['Android 18 DP1', '2026-10-01']], 'dated as the blog dated it');
});

test('fetchiOSVersions: each fallback in turn, the release feed downloaded once, and a failure only when nothing is left', async t => {
  t.mock.method(console, 'warn', () => {});
  const { fetchiOSVersions } = await import('../src/fetchers/ios.ts');
  const stable = (version: string) => async () => ({ platform: 'iOS' as const, version, releaseDate: '2026-10-01' });
  const down = async (): Promise<never> => { throw new Error('down'); };
  let feedDownloads = 0;
  const feed = (titles: string[]) => async () => { feedDownloads++; return { items: titles.map(title => ({ title, pubDate: 'Mon, 05 Oct 2026 17:05:00 PDT' })) }; };

  assert.deepEqual((await fetchiOSVersions({ asls: stable('27.0.1'), releaseFeed: feed(['iOS 27.2 RC (24B115)']), endOfLife: down })).map(v => v.version), ['27.0.1', '27.2 RC']);

  feedDownloads = 0;
  const viaFeed = await fetchiOSVersions({ asls: down, releaseFeed: feed(['iOS 27.2 beta 2 (24C1)', 'iOS 27.0.1 (24A446)']), endOfLife: down });
  assert.deepEqual(viaFeed.map(v => v.version), ['27.0.1', '27.2 beta 2']);
  assert.equal(viaFeed[0].releaseDate, '2026-10-05');
  assert.equal(feedDownloads, 1, 'the stable fallback and the beta share one download');

  const viaEol = await fetchiOSVersions({ asls: down, releaseFeed: down, endOfLife: stable('27.0.1') });
  assert.deepEqual(viaEol.map(v => v.version), ['27.0.1'], 'no feed: no beta, still a stable');

  const shipped = await fetchiOSVersions({ asls: stable('27.2'), releaseFeed: feed(['iOS 27.2 RC (24B115)']), endOfLife: down });
  assert.deepEqual(shipped.map(v => v.version), ['27.2'], 'the RC of a shipped version is left out');

  await assert.rejects(fetchiOSVersions({ asls: down, releaseFeed: down, endOfLife: down }), /Failed to fetch any iOS version info/);
});

test('the stable release date comes from the release feed\'s post for that exact build, not the catalog\'s re-posting date', async t => {
  t.mock.method(console, 'warn', () => {});
  const { fetchiOSVersions } = await import('../src/fetchers/ios.ts');
  const items = [
    { title: 'iOS 27.1 (24A95425)', pubDate: 'Thu, 22 Oct 2026 10:00:00 PDT' },
    { title: 'iOS 27.0.1 (24A446)', pubDate: 'Mon, 28 Sep 2026 10:00:00 PDT' },
  ];
  const stable = { platform: 'iOS' as const, version: '27.0.1', build: '24A446', releaseDate: '2026-10-22' };
  assert.equal(releaseDateIn(items, stable), '2026-09-28');
  assert.equal(releaseDateIn(items, { ...stable, build: '24A999' }), undefined, 'another build of that version: not its date');
  assert.equal(releaseDateIn(items, { ...stable, version: '27.0.2' }), undefined);
  const [v] = await fetchiOSVersions({ asls: async () => stable, releaseFeed: async () => ({ items }), endOfLife: async () => { throw new Error('x'); } });
  assert.equal(v.releaseDate, '2026-09-28');
  const [noFeed] = await fetchiOSVersions({ asls: async () => stable, releaseFeed: async () => { throw new Error('down'); }, endOfLife: async () => { throw new Error('x'); } });
  assert.equal(noFeed.releaseDate, '2026-10-22', 'no feed: the catalog date stands');
});

test('iOS parsers: reworded beta titles still read; a catalog without device lists or versions fails instead of guessing', () => {
  const beta = (title: string) => parseBetaReleaseFeed([{ title, pubDate: 'Tue, 13 Oct 2026 17:00:00 GMT' }]);
  assert.deepEqual([beta('iOS & iPadOS 27.2 beta 3 (24C5040a)')?.version, beta('iOS & iPadOS 27.2 beta 3 (24C5040a)')?.build], ['27.2 beta 3', '24C5040a']);
  assert.equal(beta('iOS 27.2 developer beta 3')?.version, '27.2 beta 3');
  assert.equal(beta('iOS 27.2 RC 2 (24C100)')?.version, '27.2 RC 2');
  assert.equal(beta('iOS beta program update'), null, 'no version: no beta, never "unknown"');
  assert.throws(() => parseAppleAssetCatalog({ PublicAssetSets: { iOS: [{ ProductVersion: '27.1', Build: 'x', PostingDate: '2026-10-01' }] }, AssetSets: {} }), /No iPhone devices/);
  assert.throws(() => parseAppleAssetCatalog({ PublicAssetSets: { iOS: [{ Version: '27.1', Build: 'x', PostingDate: '2026-10-01', SupportedDevices: ['iPhone17,1'] } as never] }, AssetSets: {} }), /doesn't look like a version/);
});

test('parseAppleAssetCatalog: a build for at least half as many iPhones as the widest still counts as general', () => {
  const devices = (n: number) => Array.from({ length: n }, (_, i) => `iPhone${15 + i},1`);
  const v = parseAppleAssetCatalog({ PublicAssetSets: { iOS: [
    { ProductVersion: '27.0.1', Build: 'a', PostingDate: '2026-09-28', SupportedDevices: devices(10) },
    { ProductVersion: '27.1', Build: 'b', PostingDate: '2026-10-22', SupportedDevices: devices(5) },
  ] }, AssetSets: {} });
  assert.equal(v.version, '27.1', '5 of 10: exactly half is enough');
});
