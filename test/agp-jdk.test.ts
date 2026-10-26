import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAgpReleaseNotes, parsePastReleaseLines, releaseNotesUrl } from '../src/fetchers/agp-jdk.js';
import { fixture, GARBAGE_HTML } from './helpers.js';

test('parsePastReleaseLines: minor lines from the past-releases nav, newest first', () => {
  const lines = parsePastReleaseLines(fixture('agp-past-releases.html'));
  assert.deepEqual(lines.slice(0, 6), ['9.3', '9.2', '9.1', '9.0', '8.13', '8.12']);
  assert.ok(lines.includes('7.0'));
  assert.ok(!lines.includes('1.0.1'));
  assert.equal(new Set(lines).size, lines.length);
});

test('releaseNotesUrl', () => {
  assert.equal(releaseNotesUrl('8.13'), 'https://developer.android.com/build/releases/agp-8-13-0-release-notes?hl=en');
});

test('parseAgpReleaseNotes: AGP 9.1 (KGP row, "supports Android API level X and below" phrasing)', () => {
  const url = releaseNotesUrl('9.1');
  assert.deepEqual(parseAgpReleaseNotes(fixture('agp-9-1-0-release-notes.html'), url), {
    agp: '9.1',
    jdk: '17',
    minGradle: '9.3.1',
    minBuildTools: '36.0.0',
    defaultNdk: '28.2.13676358',
    minKgp: '2.2.10',
    maxApi: '37', // "37.0" on the page: normalised like the other phrasing
    maxApiFrom: '9.1.1', // "Android Gradle plugin 9.1.1 supports …": 9.1.0 doesn't
    released: 'April 2026',
    url,
  });
});

test('parseAgpReleaseNotes: AGP 8.13 ("maximum API level ... is" phrasing, no KGP row)', () => {
  const url = releaseNotesUrl('8.13');
  assert.deepEqual(parseAgpReleaseNotes(fixture('agp-8-13-0-release-notes.html'), url), {
    agp: '8.13',
    jdk: '17',
    minGradle: '8.13',
    minBuildTools: '35.0.0',
    defaultNdk: '27.0.12077973',
    minKgp: undefined,
    maxApi: '36.1',
    released: 'September 2025',
    url,
  });
});

test('parseAgpReleaseNotes: undefined when the compatibility table is missing', () => {
  assert.equal(parseAgpReleaseNotes(GARBAGE_HTML, releaseNotesUrl('9.9')), undefined);
  assert.deepEqual(parsePastReleaseLines(GARBAGE_HTML), []);
});
