import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, minXcodeForiOSSdk, parseiPhones, parseXcodeReleases } from '../src/fetchers/ios-toolchain.ts';
import { latestStable, mavenVersions, parseAgpMetadata, parseGradleCurrent, parseSdkRepository, parseStudioReleases } from '../src/fetchers/android-toolchain.ts';

// Synthetic data in the shape of each upstream (structure only)

const xcode = (number: string, release: Record<string, boolean | number>, day: number, sdk: string) => ({
  name: 'Xcode',
  version: { number, build: `B${number}`, release },
  date: { year: 2026, month: 9, day },
  requires: '26.6',
  sdks: { iOS: [{ number: sdk }] },
  links: { notes: { url: `https://developer.apple.com/xcode-${number}` } },
});

test('compareVersions compares numerically and treats missing parts as zero', () => {
  assert.ok(compareVersions('27.10', '27.9') > 0);
  assert.equal(compareVersions('27', '27.0.0'), 0);
  assert.ok(compareVersions('9.4.1', '10.0') < 0);
});

test('parseXcodeReleases labels betas / RCs and keeps SDK, macOS requirement and notes', () => {
  const releases = parseXcodeReleases([
    xcode('27.1', { beta: 2 }, 30, '27.1'),
    xcode('27.0', { release: true }, 14, '27.0'),
    xcode('27.0', { rc: 1 }, 8, '27.0'),
    { ...xcode('9.9', { release: true }, 1, '9.9'), name: 'Xcode Tools' },
  ]);
  assert.deepEqual(releases.map(r => [r.label, r.isBeta, r.releaseDate]), [
    ['27.1 beta 2', true, '2026-09-30'],
    ['27.0', false, '2026-09-14'],
    ['27.0 RC 1', true, '2026-09-08'],
  ]);
  assert.equal(releases[1].iosSdk, '27.0');
  assert.equal(releases[1].requiresMacOS, '26.6');
  assert.equal(minXcodeForiOSSdk(releases, '27.0')?.label, '27.0');
  assert.equal(minXcodeForiOSSdk(releases, '27.1')?.label, '27.1 beta 2', 'only a beta qualifies');
});

test('parseiPhones returns every model of the newest launch', () => {
  const { newest, known } = parseiPhones([
    { releaseLabel: '18 Pro', releaseDate: '2026-09-19', supportedIosVersions: '27 - 27' },
    { releaseLabel: '18 Pro Max', releaseDate: '2026-09-19', supportedIosVersions: '27' },
    { releaseLabel: '17', releaseDate: '2025-09-19', supportedIosVersions: '26 - 27' },
  ]);
  assert.deepEqual(newest.map(n => [n.name, n.shipsWithiOS]), [['iPhone 18 Pro', '27'], ['iPhone 18 Pro Max', '27']]);
  assert.equal(known.length, 3);
  assert.deepEqual(parseiPhones([]), { newest: [], known: [] });
});

test('parseStudioReleases: newest stable or patch, and a preview only when newer', () => {
  const r = parseStudioReleases([
    { name: 'Android Studio Pear | 2026.2.1 Canary 3', version: '2026.2.1.3', channel: 'Canary', date: 'October 8, 2026' },
    { name: 'Android Studio Otter | 2026.1.1 Patch 1', version: '2026.1.1.20', channel: 'Patch', date: 'October 1, 2026' },
    { name: 'Android Studio Otter | 2026.1.1', version: '2026.1.1.18', channel: 'Release', date: 'September 10, 2026' },
  ]);
  assert.equal(r.studioStable?.version, '2026.1.1.20');
  assert.equal(r.studioStable?.releaseDate, '2026-10-01');
  assert.equal(r.studioPreview?.channel, 'Canary');
  assert.equal(parseStudioReleases([{ name: 'x', version: '1', channel: 'Release', date: 'October 1, 2026' }]).studioPreview, undefined);
});

test('maven metadata: newest stable ignores pre-releases; AGP preview only when ahead of stable', () => {
  const xml = (latest: string, versions: string[]) => `<metadata><versioning><latest>${latest}</latest><versions>${versions.map(v => `<version>${v}</version>`).join('')}</versions></versioning></metadata>`;
  assert.equal(latestStable(mavenVersions(xml('9.5.0-alpha01', ['9.4.0', '9.4.1', '9.10.0-beta01', '9.5.0-alpha01']))), '9.4.1');
  const ahead = parseAgpMetadata(xml('9.5.0-alpha01', ['9.4.1', '9.5.0-alpha01']));
  assert.deepEqual([ahead.agpStable?.version, ahead.agpPreview?.version], ['9.4.1', '9.5.0-alpha01']);
  assert.equal(parseAgpMetadata(xml('9.4.1', ['9.4.0', '9.4.1'])).agpPreview, undefined);
});

test('parseGradleCurrent formats the build time as a date', () => {
  assert.deepEqual(parseGradleCurrent({ version: '9.8.1', buildTime: '20261001120000+0000' }), {
    name: 'Gradle', version: '9.8.1', releaseDate: '2026-10-01', url: 'https://gradle.org/releases/',
  });
});

test('parseSdkRepository skips preview platforms (they carry a codename)', () => {
  const pkg = (path: string, body = '') => `<remotePackage path="${path}">${body}</remotePackage>`;
  const r = parseSdkRepository([
    pkg('platforms;android-36'),
    pkg('platforms;android-37'),
    pkg('platforms;android-38', '<codename>CANARY</codename>'),
    pkg('build-tools;36.1.0'),
    pkg('build-tools;37.0.0'),
    pkg('build-tools;37.0.0-rc1'),
  ].join(''));
  assert.deepEqual([r.sdkPlatform?.version, r.buildTools?.version], ['android-37', '37.0.0']);
});
