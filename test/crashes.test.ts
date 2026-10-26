import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CORDOVA_ISSUE_PATTERN,
  CRASH_PATTERN,
  fetchSdkCrashes,
  parseAndroidReleaseNotes,
  parseAppleReleaseNotes,
  parseGithubIssues,
  parseStackQuestions,
  pickiOSReleaseNotes,
  rankCordovaIssues,
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

test('parseGithubIssues credits the issue author when GitHub reports one', () => {
  const base = { created_at: '2026-10-01T00:00:00Z', comments: 0, title: 'App crashes on launch', repository_url: 'https://api.github.com/repos/bumptech/glide' };
  const [withUser, withoutUser] = parseGithubIssues([
    { ...base, html_url: 'u1', user: { login: 'octocat', html_url: 'https://github.com/octocat' } },
    { ...base, html_url: 'u2', user: null },
  ]);
  assert.deepEqual(withUser.author, { name: 'octocat', url: 'https://github.com/octocat' });
  assert.equal(withoutUser.author, undefined);
});

test('CORDOVA_ISSUE_PATTERN also matches white screens, apps that won\'t run and native exception names', () => {
  for (const text of [
    'Xcode 27 built cordova-ios apps won\'t run on iOS 27',
    'Android 7 app white screen: java.lang.NoClassDefFoundError: Failed resolution',
    'NSInternalInconsistencyException "This task has already been stopped" in CDVURLSchemeHandler',
    'Black screen when opening Photo Library',
    'App crashes after resume',
  ]) {
    assert.ok(CORDOVA_ISSUE_PATTERN.test(text), text);
  }
  for (const text of ['CORS error with app://localhost origin', 'StatusBarStyle not working properly', 'InAppBrowser does not open PDF', 'Error building with Gradle 9']) {
    assert.ok(!CORDOVA_ISSUE_PATTERN.test(text), text);
  }
});

test('Cordova issues map to platforms and put new-OS reports first', () => {
  const base = { comments: 1, reactions: { total_count: 0 } };
  const items = rankCordovaIssues(parseGithubIssues([
    { ...base, created_at: '2026-10-10T00:00:00Z', title: 'App crashes on start', html_url: 'u1', repository_url: 'https://api.github.com/repos/apache/cordova-android' },
    { ...base, created_at: '2026-09-22T00:00:00Z', title: 'Apps won\'t run on iOS 27', html_url: 'u2', repository_url: 'https://api.github.com/repos/apache/cordova-ios' },
    { ...base, created_at: '2026-10-01T00:00:00Z', title: 'Black screen in photo library', html_url: 'u3', repository_url: 'https://api.github.com/repos/apache/cordova-plugin-camera' },
    { ...base, created_at: '2026-10-11T00:00:00Z', title: 'Status bar colour is wrong', html_url: 'u4', repository_url: 'https://api.github.com/repos/apache/cordova-ios' },
  ], /\biOS\s*27\b/i, CORDOVA_ISSUE_PATTERN));
  assert.deepEqual(items.map(i => [i.url, i.platform, i.newOs]), [
    ['u2', 'iOS', true],
    ['u1', 'Android', false],
    ['u3', '跨平台', false],
  ]);
});

test('parseStackQuestions keeps mobile crash questions, classifies by tag and ranks by votes', () => {
  const q = (title: string, tags: string[], score = 0, answers = 0) => ({
    title, link: `https://stackoverflow.com/q/${title.length}`, tags, score, answer_count: answers, view_count: 100, is_answered: answers > 0, creation_date: 1790000000,
    owner: { display_name: 'Jane &amp; Co', link: 'https://stackoverflow.com/users/1/jane' },
  });
  const items = parseStackQuestions([
    q('App crashes on iOS 27 launch', ['ios', 'swift'], 1, 1),
    q('Which YouTube player should I use?', ['flutter', 'ios']),
    q('ClassNotFoundException crash in release build', ['android', 'kotlin'], 5, 2),
    q('Server crashes under load', ['node.js']),
    q('Expo Go app freezes &amp; hangs on start', ['react-native', 'expo']),
  ], /\biOS\s*27\b/i);
  assert.deepEqual(items.map(i => [i.platform, i.newOs]), [['Android', false], ['iOS', true], ['跨平台', false]]);
  assert.equal(items[2].title, 'Expo Go app freezes & hangs on start', 'decodes HTML entities');
  assert.deepEqual(items[0].author, { name: 'Jane & Co', url: 'https://stackoverflow.com/users/1/jane' }, 'keeps the author for CC BY-SA attribution');
});

test('fetchSdkCrashes keeps at most three reports per repo, and a failed search group only costs its repos', async t => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  const warn = t.mock.method(console, 'warn', () => {});
  const issue = (repo: string, n: number, reactions: number) => ({
    title: `App crash on launch ${n}`, html_url: `https://github.com/${repo}/issues/${n}`, repository_url: `https://api.github.com/repos/${repo}`,
    created_at: '2026-10-20T00:00:00Z', comments: 0, reactions: { total_count: reactions },
  });
  let call = 0;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const q = decodeURIComponent(String(url));
    call++;
    if (q.includes('repo:Alamofire/Alamofire')) return new Response('nope', { status: 422 });
    if (q.includes('repo:flutter/flutter')) {
      return Response.json({ items: [...Array.from({ length: 10 }, (_, i) => issue('flutter/flutter', i, 100 - i)), issue('square/okhttp', 1, 1)] });
    }
    return Response.json({ items: [] });
  }) as typeof fetch;
  const items = await fetchSdkCrashes(undefined, 30, 12, new Date('2026-10-26T00:00:00Z'));
  assert.ok(call >= 3);
  assert.equal(items.filter(i => i.context === 'flutter/flutter').length, 3);
  assert.ok(items.some(i => i.context === 'square/okhttp'), 'a quieter repo still makes the list');
  assert.ok(warn.mock.calls.some(c => /SDK search group failed/.test(String(c.arguments[0]))));
});

test('the GitHub searches ask for open issues only (a closed report is nothing to check before upgrading)', async t => {
  const { fetchCordovaCrashes } = await import('../src/fetchers/crashes.ts');
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  const queries: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => { queries.push(new URL(String(url)).searchParams.get('q') ?? ''); return Response.json({ items: [] }); }) as typeof fetch;
  await fetchSdkCrashes();
  await fetchCordovaCrashes();
  assert.ok(queries.length >= 6);
  assert.ok(queries.every(q => /\bis:open\b/.test(q)), queries.join('\n'));
});

test('fetchSdkCrashes fails only when every search group failed', async t => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = (async () => new Response('nope', { status: 422 })) as typeof fetch;
  await assert.rejects(fetchSdkCrashes(), /GitHub search failed/);
});
