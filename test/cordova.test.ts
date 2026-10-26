import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanNoteLine, parseReleaseNotes, pluginRequirements, summarizeReleaseNotes } from '../src/fetchers/cordova.ts';
import { fixture } from './helpers.ts';

// Synthetic RELEASENOTES.md in cordova-android's layout ("###" version headings)
const NOTES = `<!-- license header -->

## Release Notes for Cordova (Example) ##

### 9.1.1

**Fixes:**

* fix: crash when the \`window\` is not set ([#120](https://github.com/apache/x/pull/120)) [[abc123de](https://github.com/apache/x/commit/abc123de)]
* fix: status bar colour

### 9.1.0 (May 26, 2026)

**Features:**

* feat: something new

### 9.0.0

**Breaking Changes:**

* [GH-101](https://github.com/apache/x/pull/101) feat!: bump node engine requirement >=20.5.0
* feat!: drop **iOS**-sim ([#102](https://github.com/apache/x/pull/102))

**Fixes:**

* fix: old fix

### 9.0.0-beta.1 (Oct 17, 2025)

**Breaking Changes:**

* feat!: beta-only change

### 8.0.0 (Jul 07, 2024)

**Breaking:**

* chore!: older major
`;

test('cleanNoteLine strips PR / commit links and markdown', () => {
  assert.equal(cleanNoteLine('* fix: crash when the `window` is not set ([#120](https://x/120)) [[abc123de](https://x/c)]'), 'fix: crash when the window is not set');
  assert.equal(cleanNoteLine('* [GH-101](https://x/101) feat!: bump node'), 'feat!: bump node');
  assert.equal(cleanNoteLine('* feat!: drop **iOS**-sim'), 'feat!: drop iOS-sim');
});

test('parseReleaseNotes splits version sections with their bold-headed lists', () => {
  const sections = parseReleaseNotes(NOTES);
  assert.deepEqual(sections.map(s => s.version), ['9.1.1', '9.1.0', '9.0.0', '9.0.0-beta.1', '8.0.0']);
  assert.deepEqual([...sections[2].lists.keys()], ['Breaking Changes', 'Fixes']);
});

test('summarizeReleaseNotes takes breaking changes of the current major and fixes of the latest release', () => {
  assert.deepEqual(summarizeReleaseNotes(NOTES, '9.1.1'), {
    majorRelease: '9.0.0',
    breaking: ['feat!: bump node engine requirement >=20.5.0', 'feat!: drop iOS-sim'],
    fixes: ['fix: crash when the window is not set', 'fix: status bar colour'],
  });
  // "**Breaking:**" heading of older releases, and no section for an unreleased version
  assert.deepEqual(summarizeReleaseNotes(NOTES, '8.0.0').breaking, ['chore!: older major']);
  assert.deepEqual(summarizeReleaseNotes(NOTES, '9.2.0').fixes, []);
});

test('summarizeReleaseNotes reads cordova-ios notes, whose version headings are "##"', () => {
  const notes = fixture('cordova-ios-releasenotes.md');
  assert.deepEqual(parseReleaseNotes(notes).map(s => s.version), ['8.2.0', '8.1.1', '8.0.0', '8.0.0-beta.1']);
  const summary = summarizeReleaseNotes(notes, '8.1.1');
  assert.equal(summary.majorRelease, '8.0.0');
  assert.deepEqual(summary.breaking, ['chore!: update dependencies & node engine', 'feat!: drop iOS-sim & use simctl directly']);
  assert.deepEqual(summary.fixes, ['fix: dont call nativeFetchMessages if not implemented', 'fix: proper macro check for TARGET_OS_VISION']);
});

test('pluginRequirements takes the highest entry not above the version, skipping placeholders and dev builds', () => {
  const deps = {
    '5.0.0': { cordova: '>=9.0.0', 'cordova-android': '>=9.0.0' },
    '7.0.0': { cordova: '>=9.0.0', 'cordova-ios': '>=5.1.0', 'cordova-android': '>=12.0.0' },
    '9.0.0': { cordova: '>100' },
    '7.5.0-dev': { 'cordova-android': '<10.0.0' },
  };
  assert.deepEqual(pluginRequirements(deps, '8.0.0'), { cordova: '>=9.0.0', 'cordova-ios': '>=5.1.0', 'cordova-android': '>=12.0.0' });
  assert.deepEqual(pluginRequirements(deps, '6.1.0'), { cordova: '>=9.0.0', 'cordova-android': '>=9.0.0' });
  assert.deepEqual(pluginRequirements(deps, '4.0.0'), {});
  assert.deepEqual(pluginRequirements(undefined, '1.0.0'), {});
});

test('release notes: "v8.1.1" and "[8.1.1](…)" headings read too; a file with no version sections fails', () => {
  const md = (heading: string) => `## ${heading}\n\n**Breaking Changes:**\n\n* drop old API\n\n**Fixes:**\n\n* fix crash\n`;
  assert.deepEqual(parseReleaseNotes(md('v8.0.0')).map(s => s.version), ['8.0.0']);
  assert.deepEqual(parseReleaseNotes(md('[8.0.0](https://github.com/apache/cordova-ios/releases/tag/8.0.0) (Oct 1, 2026)')).map(s => s.version), ['8.0.0']);
  assert.deepEqual(summarizeReleaseNotes(md('v8.0.0'), '8.0.0').breaking, ['drop old API']);
  assert.throws(() => summarizeReleaseNotes('# Release Notes\n\nNothing here', '8.0.0'), /no version sections/);
});
