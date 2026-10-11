import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CRASH_PATTERN,
  parseAndroidReleaseNotes,
  parseAppleReleaseNotes,
  parseGithubIssues,
  pickiOSReleaseNotes,
} from '../src/fetchers/crashes.ts';

test('CRASH_PATTERN matches crash wording but not words that merely contain it', () => {
  for (const text of ['Photos might quit unexpectedly', 'App crashes on launch', 'Device hangs', 'ANR when launched', 'deadlock for @Query']) {
    assert.ok(CRASH_PATTERN.test(text), text);
  }
  assert.ok(CRASH_PATTERN.test('devices unexpectedly reboot when scrolling'));
  for (const text of ['Change X to Y', 'Exchange rates', 'Voice Editing commands might not work', 'runtimes re-appear after a reboot', 'without needing to reboot']) {
    assert.ok(!CRASH_PATTERN.test(text), text);
  }
});

const applePage = {
  metadata: { title: 'iOS & iPadOS 27.2 Beta 3 Release Notes' },
  primaryContentSections: [{ type: 'content', content: [
    { type: 'heading', level: 3, text: 'SwiftUI' },
    { type: 'heading', level: 4, text: 'Known Issues' },
    { type: 'paragraph', inlineContent: [{ type: 'text', text: 'Apps using ' }, { type: 'codeVoice', code: 'ScrollView' }, { type: 'text', text: ' might crash on rotation. (180000001)' }] },
    { type: 'paragraph', inlineContent: [{ type: 'text', text: 'Workaround: Avoid the crash by disabling rotation.' }] },
    { type: 'paragraph', inlineContent: [{ type: 'text', text: 'Change X to Y might not work. (180000002)' }] },
    { type: 'heading', level: 3, text: 'Photos' },
    { type: 'heading', level: 4, text: 'Resolved Issues' },
    { type: 'paragraph', inlineContent: [{ type: 'text', text: 'Fixed: Photos might quit unexpectedly. (180000003)' }] },
    { type: 'heading', level: 4, text: 'New Features' },
    { type: 'paragraph', inlineContent: [{ type: 'text', text: 'New crash reporting API.' }] },
  ] }],
};

test('parseAppleReleaseNotes keeps crash entries from Known / Resolved Issues with their topic', () => {
  const items = parseAppleReleaseNotes(applePage, 'https://example.com/rn', 'iOS', 'iOS release notes');
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(i => [i.kind, i.context]), [
    ['known', 'iOS & iPadOS 27.2 Beta 3 · SwiftUI'],
    ['fixed', 'iOS & iPadOS 27.2 Beta 3 · Photos'],
  ]);
  assert.equal(items[0].title, 'Apps using ScrollView might crash on rotation. (180000001)');
  assert.equal(items[1].title, 'Photos might quit unexpectedly. (180000003)', 'strips the "Fixed:" prefix');
});

test('pickiOSReleaseNotes returns the .0 page and the newest point / beta release', () => {
  const index = { references: {
    a: { title: 'iOS & iPadOS 26.6 Release Notes', url: '/documentation/ios-ipados-release-notes/ios-ipados-26_6-release-notes' },
    b: { title: 'iOS & iPadOS 27 Release Notes', url: '/documentation/ios-ipados-release-notes/ios-ipados-27-release-notes' },
    c: { title: 'iOS & iPadOS 27.1 Release Notes', url: '/documentation/ios-ipados-release-notes/ios-ipados-27_1-release-notes' },
    d: { title: 'iOS & iPadOS 27.2 Beta 3 Release Notes', url: '/documentation/ios-ipados-release-notes/ios-ipados-27_2-release-notes' },
  } };
  assert.deepEqual(pickiOSReleaseNotes(index, '27').map(p => p.title), [
    'iOS & iPadOS 27 Release Notes',
    'iOS & iPadOS 27.2 Beta 3 Release Notes',
  ]);
});

test('parseAndroidReleaseNotes reads known issues and the latest fixed sections only', () => {
  const html = `
    <h2>Android 17 QPR 2 Beta 7 (October 2026)</h2><p>intro</p>
    <h3>Known issue in Beta 7</h3><ul><li>Camera app crashes when switching lenses. (<a href="https://issuetracker.google.com/issues/111">Issue #111</a>)</li><li>Wallpaper colors are off.</li></ul>
    <h3>Top Issues fixed in Beta 7 (October 2026)</h3><ul><li>An issue that caused app crashes in WindowManagerGlobal. (<a href="https://issuetracker.google.com/issues/222">Issue #222</a>)</li></ul>
    <h3>Top Issues fixed in Beta 6 (September 2026)</h3><ul><li>Device hangs when scrolling.</li></ul>
    <h3>Top Issues fixed in Beta 5 (August 2026)</h3><ul><li>Settings crashes on open.</li></ul>`;
  const items = parseAndroidReleaseNotes(html, 'https://example.com/qpr2', 'Android 17 QPR2');
  assert.deepEqual(items.map(i => i.kind), ['known', 'fixed', 'fixed'], 'only the 2 newest fixed sections');
  assert.equal(items[0].url, 'https://issuetracker.google.com/issues/111');
  assert.equal(items[0].title, 'Camera app crashes when switching lenses.');
  assert.match(items[1].context, /^Android 17 QPR2 · Beta 7/);
});

test('parseGithubIssues maps repos to platforms, flags new-OS reports and drops web-only / PRs', () => {
  const base = { created_at: '2026-10-01T00:00:00Z', comments: 3, reactions: { total_count: 5 } };
  const items = parseGithubIssues([
    { ...base, title: 'Crash on iOS 27 in Analytics', html_url: 'u1', repository_url: 'https://api.github.com/repos/firebase/firebase-ios-sdk' },
    { ...base, title: '[web] skwasm crashes', html_url: 'u2', repository_url: 'https://api.github.com/repos/flutter/flutter' },
    { ...base, title: 'Fix crash', html_url: 'u3', repository_url: 'https://api.github.com/repos/square/okhttp', pull_request: {} },
    { ...base, title: 'Glide crashes with OOM', html_url: 'u4', repository_url: 'https://api.github.com/repos/bumptech/glide' },
  ], /\biOS\s*27\b/i);
  assert.deepEqual(items.map(i => [i.platform, i.newOs, i.context]), [
    ['iOS', true, 'firebase/firebase-ios-sdk'],
    ['Android', false, 'bumptech/glide'],
  ]);
});
