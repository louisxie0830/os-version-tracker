import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionableSentences, datedSections, parseSdkReleaseNotes } from '../src/fetchers/sdk-releases.ts';

// Synthetic release notes in the shape of the Firebase / Google Play services pages (structure only)
const section = (id: string, heading: string, body: string) => `<h2 id="${id}">${heading}</h2>${body}`;
const filler = Array.from({ length: 6 }, (_, i) => section(`old_${i}`, `Version 1.${i}.0 - January ${i + 1}, 2024`, '<p>Fixed a bug.</p>')).join('');
const FIREBASE = section('version_1300_-_october_7_2026', 'Version 13.0.0 - October 7, 2026', `
  <p>Firebase is no longer distributed through CocoaPods. Use Swift Package Manager.</p>
  <ul><li><p>Breaking change: Firebase's minimum supported versions have been updated for the following platforms:</p>
    <table><tr><th>Platform</th><th>Firebase 13</th></tr><tr><td>iOS</td><td>15.0</td></tr></table></li>
  <li>Breaking change: FirebaseMLModelDownloader has been removed. (#16540)</li></ul>
  <h3>Cloud Firestore</h3><ul><li>Fixed a crash.</li></ul>`)
  + section('version_12190_-_september_9_2026', 'Version 12.19.0 - September 9, 2026', '<p>Added a feature.</p>')
  + section('android_old', 'Update - July 30, 2026', '<h3>Firebase ML version 26.1.1</h3><p>Firebase ML is deprecated and will be shut down on June 15, 2027. Migrate to Cloud Storage.</p>')
  + filler;
const PLAY_SERVICES = section('september_17_2026', 'September 17, 2026', `
  <ul><li><p>The latest updates to the <code>play-services-base</code> library (v18.11.0) and <code>play-services-basement</code> library include the following changes:</p>
  <ul><li><p>Changed the <code>minSdkVersion</code> to 24.</p></li><li><p>Fixed minor bugs.</p></li></ul></li></ul>
  <h4>Artifacts released on maven.google.com</h4><ul><li>com.google.android.gms:play-services-base:18.11.0</li></ul>`)
  + section('march_1_2025', 'March 1, 2025', '<p>All classes within com.google.android.gms.awareness.* are now deprecated. API calls may start failing as early as January 2027.</p>')
  + filler;
const NOW = new Date('2026-10-26T00:00:00Z');
const spec = (source: string) => ({ url: 'https://example.com/notes', platform: 'Android' as const, source, title: (s: { date: string }) => `${source} ${s.date}` });

test('datedSections: only h2 sections whose heading ends in a date', () => {
  const sections = datedSections(`<h2 id="summary">Page Summary</h2><p>x</p>${FIREBASE}`);
  assert.equal(sections[0].date, '2026-10-07');
  assert.equal(sections.find(s => s.id === 'summary'), undefined);
});

test('actionableSentences: paragraphs and list items that call for action, with their library; tables and artifact lists stay out', () => {
  assert.deepEqual(actionableSentences(datedSections(PLAY_SERVICES)[0].html), ['play-services-base、play-services-basement：Changed the minSdkVersion to 24.']);
  const firebase = actionableSentences(datedSections(FIREBASE)[0].html);
  assert.ok(firebase.includes('Breaking change: FirebaseMLModelDownloader has been removed.'), 'issue numbers dropped');
  assert.ok(!firebase.some(s => /Fixed a crash/.test(s)));
});

test('parseSdkReleaseNotes: recent breaking releases, a table-given minimum iOS first, and future cutoffs from notes of any age', () => {
  const items = parseSdkReleaseNotes(FIREBASE, spec('Firebase Apple SDK'), NOW);
  const release = items.find(i => i.date === '2026-10-07')!;
  assert.match(release.detail, /^最低支援 iOS 15\.0；Firebase is no longer distributed through CocoaPods/);
  assert.equal(release.url, 'https://example.com/notes#version_1300_-_october_7_2026');
  assert.equal(items.find(i => i.date === '2026-09-09'), undefined, 'nothing to act on: no item');
  const cutoff = items.find(i => i.date === '2027-06-15')!;
  assert.match(cutoff.title, /停用預告/);
  assert.match(cutoff.detail, /^Firebase ML is deprecated and will be shut down on June 15, 2027\. Migrate/);

  const gms = parseSdkReleaseNotes(PLAY_SERVICES, spec('Google Play services'), NOW);
  const early = gms.find(i => i.date === '2027-01-01')!;
  assert.match(early.detail, /awareness.*as early as January 2027.*（官方只公布月份，最早可能在該月）$/);
  assert.equal(gms.filter(i => i.date === '2025-03-01').length, 0, 'an old release itself is past the window');
});

test('parseSdkReleaseNotes: a page without dated sections (changed layout) fails', () => {
  assert.throws(() => parseSdkReleaseNotes('<h2 id="x">Overview</h2><p>…</p>', spec('Firebase Apple SDK'), NOW), /only 0 dated sections/);
});

test('actionableSentences: notes in an aside count, a lowered minimum does not, and one change across many libraries is listed once', () => {
  assert.deepEqual(actionableSentences('<aside class="note">Calls to these APIs will fail after the cutoff.</aside>'), ['Calls to these APIs will fail after the cutoff.']);
  assert.deepEqual(actionableSentences('<h3>Firebase Auth version 23.0.0</h3><ul><li>Downgraded minSdkVersion to 21.</li></ul>'), []);
  const many = ['a', 'b', 'c', 'd'].map(l => `<h3>firebase-${l} version 1.0.0</h3><ul><li>Updated minSdkVersion to 24.</li></ul>`).join('');
  assert.deepEqual(actionableSentences(many), ['Updated minSdkVersion to 24.（4 個函式庫：firebase-a、firebase-b、firebase-c…）']);
  const two = ['a', 'b'].map(l => `<h3>firebase-${l} version 1.0.0</h3><ul><li>Updated minSdkVersion to 24.</li></ul>`).join('');
  assert.deepEqual(actionableSentences(two), ['firebase-a、firebase-b：Updated minSdkVersion to 24.']);
});

test('futureCutoffs: the library in the title, the item before when the note only says "the deprecated APIs", and every way Google words a date', async () => {
  const { futureCutoffs } = await import('../src/fetchers/sdk-releases.ts');
  const games = futureCutoffs('<ul><li><p>The latest updates to the play-services-games library (v24.0.0) includes the following changes:</p><ul><li>Deprecated the Games v1 SDK and APIs.</li><li>Important: Starting in May 2026, the deprecated APIs will be removed from the SDK. Then, as early as July 2028, calls to these APIs will fail.</li></ul></li></ul>', '2026-10-26');
  assert.deepEqual(games.map(c => [c.date, c.library, c.monthOnly]), [['2028-07-01', 'play-services-games', true]], 'May 2026 is past');
  assert.match(games[0].sentence, /^Deprecated the Games v1 SDK and APIs\. Important:/);
  const worded = (text: string) => futureCutoffs(`<p>${text}</p>`, '2026-10-26').map(c => [c.date, c.monthOnly]);
  assert.deepEqual(worded('The API will stop working on March 3, 2027.'), [['2027-03-03', false]]);
  assert.deepEqual(worded('Calls may fail as early as January 15, 2027.'), [['2027-01-15', false]]);
  assert.deepEqual(worded('The service will be shut down in June 2027.'), [['2027-06-01', true]]);
  assert.deepEqual(worded('It will be turned down after February 1, 2027.'), [['2027-02-01', false]]);
  assert.deepEqual(worded('Calls may fail as early as October 2026.'), [['2026-10-01', true]], 'a month under way stays until it is over');
  assert.deepEqual(worded('Shut down on October 1, 2026.'), [], 'a past day goes');
  assert.equal(futureCutoffs('<p>com.google.android.gms.awareness.* is deprecated; calls may fail as early as January 2027.</p>', '2026-10-26')[0].library, 'awareness');
});

test('parseSdkReleaseNotes: a release whose only change is a cutoff is not listed again on its own date', () => {
  const html = section('2026-07-30', 'Update - July 30, 2026', '<h3>Firebase ML version 26.1.1</h3><p>Firebase ML is deprecated and will be shut down on June 15, 2027. Migrate to Cloud Storage.</p>')
    + Array.from({ length: 6 }, (_, i) => section(`f_${i}`, `Version 1.${i}.0 - January ${i + 1}, 2024`, '<p>Fixed a bug.</p>')).join('');
  const items = parseSdkReleaseNotes(html, spec('Firebase Android SDK'), NOW);
  assert.deepEqual(items.map(i => [i.date, i.title]), [['2027-06-15', 'Firebase Android SDK：Firebase ML 停用預告']]);
});

test('parseSdkReleaseNotes: one cutoff notice for several libraries is one item, named by none of them, and not repeated in the release', () => {
  const libs = ['firebase-a', 'firebase-b', 'firebase-c'].map(l => `<h3>${l} version 1.0.0</h3><ul><li>The legacy API will be removed and shut down in June 2027.</li></ul>`).join('');
  const html = section('2026-10-01', 'October 1, 2026', libs)
    + Array.from({ length: 6 }, (_, i) => section(`f_${i}`, `Version 1.${i}.0 - January ${i + 1}, 2024`, '<p>Fixed a bug.</p>')).join('');
  const items = parseSdkReleaseNotes(html, spec('Firebase Android SDK'), NOW);
  assert.deepEqual(items.map(i => [i.date, i.title]), [['2027-06-01', 'Firebase Android SDK：停用預告']], 'no release item repeating it');
  assert.match(items[0].detail, /^The legacy API will be removed.*（涉及：firebase-a、firebase-b、firebase-c）$/);
});
