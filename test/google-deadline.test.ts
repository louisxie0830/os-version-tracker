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

test('parseGooglePlayDeadline: lists with attributes, and the dated heading over an earlier "Starting" in the text', () => {
  const html = `<p>Starting soon after review, apps may be hidden. Starting January 5, 2026 the old rule ended.</p>
    <h3>Starting August 31, 2027:</h3>
    <ul class="devsite-list"><li class="item">New apps and app updates must target Android 17 (API level 37) or higher; except for Wear OS apps, which must target Android 16 (API level 36) or higher.</li></ul>`;
  const d = parseGooglePlayDeadline(html);
  assert.equal(d.deadline, 'August 31, 2027');
  assert.deepEqual(d.requirements.map(r => r.sdk), ['Android 17 (API level 37) or higher', 'Android 16 (API level 36) or higher']);
});

test('parseGooglePlayDeadline: a reworded list intro still finds the current deadline, not an older one mentioned first', () => {
  const html = `<p>Starting August 31, 2025, apps had to target API 35.</p>
    <h3>From August 31, 2026:</h3>
    <ul><li>New apps and app updates must target Android 16 (API level 36) or higher.</li></ul>
    <p>You can request an extension to November 1, 2026.</p>`;
  const d = parseGooglePlayDeadline(html);
  assert.equal(d.deadline, 'August 31, 2026');
  assert.equal(d.requirements[0].sdk, 'Android 16 (API level 36) or higher');
  assert.equal(d.extensionDate, 'November 1, 2026');
  const backwards = parseGooglePlayDeadline(html.replace('extension to November 1, 2026', 'extension to May 1, 2026'));
  assert.equal(backwards.extensionDate, undefined, 'an "extension" before the deadline is not its extension');
});

test('existing apps of other device types: the levels Google gives as restricted become the minimum to stay available', () => {
  const html = `<p>Starting August 31 2026:</p><ul>
    <li>New apps and app updates must target Android 16 (API level 36) or higher to be submitted to Google Play.</li>
    <li>Existing apps must target Android 15 (API level 35) or higher to remain available to new users. Apps that target Android 14 (API level 34) or lower, including Android 13 (API level 33) or lower for Wear OS, Android TV, and Android XR, and Android 12 (API level 31) or lower for Android Automotive OS, will only be available on devices running Android OS that are the same or lower.</li></ul>`;
  const { requirements } = parseGooglePlayDeadline(html);
  assert.deepEqual(requirements.slice(2), [
    { platform: 'Existing Wear OS, Android TV, Android XR apps', sdk: 'API level 34 or higher' },
    { platform: 'Existing Android Automotive OS apps', sdk: 'API level 32 or higher' },
  ]);
});

test('a newer deadline posted while an older one is on the page: the newer is the deadline, the older kept with its own list and extension', () => {
  const html = `<p>Starting August 31 2027:</p><ul><li>New apps and app updates must target Android 17 (API level 37) or higher.</li></ul>
    <p>Starting August 31 2026:</p><ul><li>New apps and app updates must target Android 16 (API level 36) or higher.</li></ul>
    <p>If you need more time to update your app, you'll be able to request an extension to November 1, 2026.</p>`;
  const parsed = parseGooglePlayDeadline(html);
  assert.equal(parsed.deadline, 'August 31, 2027');
  assert.equal(parsed.extensionDate, undefined, 'the older deadline\'s extension is not the newer one\'s');
  assert.equal(parsed.requirements[0].sdk, 'Android 17 (API level 37) or higher');
  assert.deepEqual(parsed.earlier?.map(d => [d.deadline, d.requirements[0].sdk, d.extensionDate]), [['August 31, 2026', 'Android 16 (API level 36) or higher', 'November 1, 2026']]);
});

test('an earlier deadline named twice on the page is kept once', () => {
  const block = (date: string, api: number) => `<p>Starting ${date}:</p><ul><li>New apps and app updates must target Android ${api - 20} (API level ${api}) or higher.</li></ul>`;
  const parsed = parseGooglePlayDeadline(block('August 31 2027', 37) + block('August 31 2026', 36) + "<p>request an extension to November 1, 2026.</p>" + block('August 31 2026', 36));
  assert.deepEqual(parsed.earlier?.map(d => [d.deadline, d.extensionDate]), [['August 31, 2026', 'November 1, 2026']]);
});
