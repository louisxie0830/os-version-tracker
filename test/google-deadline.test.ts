import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GOOGLE_TARGET_SDK_URL, parseGooglePlayDeadline } from '../src/fetchers/google-deadline.js';
import { fixture, GARBAGE_HTML } from './helpers.js';

test('target SDK URL forces English (machine-translated pages break the parser)', () => {
  assert.equal(new URL(GOOGLE_TARGET_SDK_URL).searchParams.get('hl'), 'en');
});

test('parseGooglePlayDeadline: deadline, per-platform targets and extension', () => {
  const result = parseGooglePlayDeadline(fixture('play-target-sdk.html'));
  assert.equal(result.source, 'google');
  assert.equal(result.deadline, 'August 31, 2026');
  assert.equal(result.extensionDate, 'November 1, 2026');
  assert.deepEqual(result.requirements[0], { platform: 'New apps and app updates', sdk: 'Android 16 (API level 36) or higher' });
  assert.deepEqual(result.requirements.find(r => r.platform === 'Wear OS and Android Automotive OS'), {
    platform: 'Wear OS and Android Automotive OS',
    sdk: 'Android 15 (API level 35) or higher',
  });
  assert.deepEqual(result.requirements.find(r => r.platform === 'Existing apps'), {
    platform: 'Existing apps',
    sdk: 'Android 15 (API level 35) or higher',
  });
});

test('parseGooglePlayDeadline throws on an unrecognised layout', () => {
  assert.throws(() => parseGooglePlayDeadline(''), /deadline not found/);
  // "Starting <date>" survives but the requirement list doesn't (e.g. a translated page)
  assert.throws(
    () => parseGooglePlayDeadline('<p>Starting August 31, 2026:</p><ul><li>Las apps nuevas deben orientarse a Android 16</li></ul>'),
    /requirements parsed empty/,
  );
  assert.throws(() => parseGooglePlayDeadline(GARBAGE_HTML));
});
