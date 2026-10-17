import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countSection, parseFlutterReleases, parseReactNativeReleases } from '../src/fetchers/frameworks.ts';

const notes = `### Breaking

- **Android**: removed X
- **iOS**: renamed Y

### Added

- something

### Deprecated

#### Android specific

- old API

### Security

- bumped Z`;

test('countSection counts bullets under a heading, including its sub-headings', () => {
  assert.equal(countSection(notes, /^breaking/i), 2);
  assert.equal(countSection(notes, /^deprecated/i), 1, 'items under a "#### Android specific" sub-heading still count');
  assert.equal(countSection(notes, /^security/i), 1);
  assert.equal(countSection('no headings', /^breaking/i), 0);
});

const rel = (tag: string, date: string, prerelease = false, body = '') => ({ tag_name: tag, prerelease, draft: false, published_at: `${date}T00:00:00Z`, html_url: `https://github.com/facebook/react-native/releases/tag/${tag}`, body });

test('parseReactNativeReleases: stable only, newest patch per minor, notes counted from each x.y.0', () => {
  const rn = parseReactNativeReleases([
    rel('v0.89.0-rc.0', '2026-10-16', true, notes),
    rel('v0.88.0', '2026-10-15', false, notes),
    rel('v0.87.1', '2026-08-26'),
    rel('v0.86.3', '2026-08-24'),
    rel('v0.87.0', '2026-08-11', false, '### Fixed\n- a'),
    rel('v0.86.0', '2026-06-01', false, '### Breaking\n- one'),
  ]);
  assert.equal(rn.latest.version, '0.88.0');
  assert.deepEqual(rn.recentMinors.map(r => [r.version, r.breaking, r.security]), [['0.88.0', 2, 1], ['0.87.1', 0, 0], ['0.86.3', 1, 0]]);
  assert.throws(() => parseReactNativeReleases([rel('v0.89.0-rc.0', '2026-10-16', true)]));
});

test('parseFlutterReleases: the current stable, one entry per version (not per CPU), latest patch per minor', () => {
  const r = (version: string, date: string, hash = version, channel = 'stable') => ({ hash, channel, version, release_date: `${date}T00:00:00Z`, dart_sdk_version: '3.13.5' });
  const flutter = parseFlutterReleases({
    current_release: { stable: 'h3477' },
    releases: [
      r('3.48.0-1.0.pre', '2026-10-10', 'b', 'beta'),
      r('3.47.7', '2026-10-08', 'h3477'), r('3.47.7', '2026-10-08', 'h3477'),
      r('3.47.6', '2026-10-01'), r('3.46.2', '2026-08-01'), r('3.45.0', '2026-06-01'),
    ],
  });
  assert.equal(flutter.latest.version, '3.47.7');
  assert.equal(flutter.latest.dart, '3.13.5');
  assert.deepEqual(flutter.recentMinors.map(m => m.version), ['3.47.7', '3.46.2', '3.45.0']);
});
