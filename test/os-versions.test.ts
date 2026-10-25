import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAppleAssetCatalog, parseBetaReleaseFeed, parseEndOfLifeiOS, parseStableReleaseFeed } from '../src/fetchers/ios.ts';
import { parseBetaFeed, parseBetaTitle, parseEndOfLifeAndroid } from '../src/fetchers/android.ts';

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
