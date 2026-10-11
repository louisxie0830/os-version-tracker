import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkProject, parseConfig, upgradePlan } from '../src/checker.ts';
import type { AllVersions } from '../src/fetch-all.ts';
import type { ActionItem } from '../src/types.ts';

// A fixed snapshot of the data the checker reads (no network): 2026-10 state of the world
const data = {
  ios: [{ platform: 'iOS', version: '27.0.1', releaseDate: '2026-10-09' }],
  appleDeadline: {
    source: 'apple',
    deadline: 'April 28, 2026',
    requirements: [{ platform: 'iOS and iPadOS', sdk: 'iOS 26 & iPadOS 26 SDK or later' }],
  },
  xcodeSupport: [
    { xcode: '27.1 RC', macOS: 'macOS Tahoe 26.6 or later', iosSdk: '27.1', deploymentiOS: '15–27', deviceiOS: '17 or later' },
    { xcode: '27', macOS: 'macOS Tahoe 26.6 or later', iosSdk: '27', deploymentiOS: '15–27', deviceiOS: '17 or later' },
    { xcode: '26.3', macOS: 'macOS Sequoia 15.6 - macOS Tahoe 26.x', iosSdk: '26.2', deploymentiOS: '15–26.2', deviceiOS: '15 or later' },
  ],
  timeline: [
    { platform: 'iOS', date: '2026-09-09', title: 'iOS and iPadOS minimum system requirements', detail: 'iOS and iPadOS apps uploaded to App Store Connect must target iOS 13 or later.', source: 'Apple', url: 'https://developer.apple.com/news/upcoming-requirements/' },
    { platform: 'Android', date: '2026-08-31', extensionDate: '2026-11-01', title: 'Play Billing Library 7 停止支援', detail: '仍使用 PBL 7 的新 App 與更新將無法上架。最新版本為 9.1.0。', source: 'Google', url: 'https://developer.android.com/google/play/billing/deprecation-faq' },
    { platform: 'Android', date: '2027-08-31', extensionDate: '2027-11-01', title: 'Play Billing Library 8 停止支援', detail: '仍使用 PBL 8 的新 App 與更新將無法上架。最新版本為 9.1.0。', source: 'Google', url: 'https://developer.android.com/google/play/billing/deprecation-faq' },
    { platform: 'Android', date: '2027-02-01', title: '16 KB 記憶體分頁大小支援', detail: 'Starting February 1, 2027, …', source: 'Google', url: 'https://developer.android.com/guide/practices/page-sizes' },
  ],
  iosAdoption: { measuredAt: 'June 7, 2026', recentDevices: [], allDevices: [] },
  googleDeadline: {
    source: 'google',
    deadline: 'August 31, 2026',
    extensionDate: 'November 1, 2026',
    requirements: [{ platform: 'New apps and app updates', sdk: 'Android 16 (API level 36) or higher' }],
  },
  androidCompat: {
    agpGradle: [{ agp: '9.4', minGradle: '9.6.0' }, { agp: '8.13', minGradle: '8.13' }, { agp: '8.7', minGradle: '8.9' }],
    studioAgp: [],
    apiLevels: [{ api: '36', minStudio: 'Meerkat', minAgp: '8.9.1' }, { api: '35', minStudio: 'Koala', minAgp: '8.6.0' }],
    kotlin: [
      { kotlin: '2.4.20–2.4.21', gradle: ['7.6.3', '9.7.0'], agp: ['8.5.2', '9.3.1'] },
      { kotlin: '2.0.20–2.0.21', gradle: ['6.8.3', '8.8'], agp: ['7.1.3', '8.5'] },
    ],
    current: { agp: '9.4', maxApi: '37', minGradle: '9.6.0', jdk: '17' },
  },
  androidToolchain: { agpStable: { name: 'Android Gradle Plugin', version: '9.4.1' } },
  agpJdk: [{ agp: '9.4', jdk: '17', url: '' }, { agp: '8.7', jdk: '17', url: '' }],
} as unknown as AllVersions;

// Inside the Play Billing 7 extension window, before the 16 KB deadline
const NOW = new Date('2026-10-11T12:00:00+08:00');
const find = (items: ActionItem[], re: RegExp) => items.find(i => re.test(i.title));

test('parseConfig keeps plain version numbers only', () => {
  const config = parseConfig(new URLSearchParams('xcode=26.3&macos=15.6&deployment=12&agp=8.7.3&jdk=17&targetSdk=35&billing=<script>&native=1&kotlin=2.0.21 '));
  assert.deepEqual(config, { xcode: '26.3', macos: '15.6', deployment: '12', jdk: '17', agp: '8.7.3', kotlin: '2.0.21', targetSdk: '35', native: true });
  assert.equal(parseConfig(new URLSearchParams('xcode=abc&foo=1')), null);
  assert.equal(parseConfig(new URLSearchParams('')), null);
});

test('iOS: Xcode versus the required SDK', () => {
  const old = checkProject({ xcode: '16.4' }, data, NOW).ios;
  assert.equal(find(old, /無法上架/)?.status, 'urgent');
  assert.equal(find(old, /無法上架/)?.target, '26');
  const current = checkProject({ xcode: '27' }, data, NOW).ios;
  assert.equal(find(current, /符合 App Store 上架要求/)?.status, 'ok');
  assert.equal(find(current, /無法在 iOS/), undefined, 'Xcode 27 can debug iOS 27.0.1');
});

test('iOS: macOS versus Xcode requirements', () => {
  const old = checkProject({ macos: '15.6' }, data, NOW).ios;
  const item = find(old, /無法安裝最新的 Xcode/);
  assert.equal(item?.status, 'upcoming');
  assert.match(item!.detail, /最高可用 Xcode 26\.3/);
  assert.equal(find(checkProject({ macos: '26.6' }, data, NOW).ios, /可安裝最新的 Xcode/)?.status, 'ok');
});

test('iOS: deployment target versus App Store minimum and Xcode floor', () => {
  const ios = checkProject({ deployment: '12' }, data, NOW).ios;
  assert.equal(find(ios, /低於 App Store 最低要求 iOS 13/)?.status, 'urgent');
  assert.equal(find(ios, /需把部署版本提高到 iOS 15/)?.status, 'upcoming');
  assert.equal(find(checkProject({ deployment: '16' }, data, NOW).ios, /符合上架與最新 Xcode/)?.status, 'ok');
});

test('Android: targetSdk deadline and extension window', () => {
  const low = find(checkProject({ targetSdk: '35' }, data, NOW).android, /targetSdk 35 不符合/);
  assert.equal(low?.status, 'urgent');
  assert.match(low!.detail, /延長期限至 2026 年 11 月 1 日（剩 21 天）/);
  const ok = find(checkProject({ targetSdk: '36' }, data, NOW).android, /targetSdk 36 符合/);
  assert.equal(ok?.status, 'ok');
  assert.equal(ok?.estimated, true, 'next year’s bump is an estimate');
});

test('Android: AGP / Gradle and Kotlin compatibility', () => {
  const android = checkProject({ agp: '8.7.3', gradle: '8.7', kotlin: '2.0.21', targetSdk: '36' }, data, NOW).android;
  assert.equal(find(android, /AGP 8\.7\.3 需要 Gradle 8\.9/)?.status, 'urgent');
  assert.equal(find(android, /AGP 8\.7\.3 不支援 API 36/)?.target, '8.9.1');
  assert.equal(find(android, /Kotlin 2\.0\.21 未正式支援/)?.status, 'upcoming');
  const good = checkProject({ agp: '9.4.1', gradle: '9.6.0', kotlin: '2.4.21' }, data, NOW).android;
  assert.equal(find(good, /與 Gradle 9\.6\.0 相容/)?.status, 'ok');
  assert.match(find(good, /Kotlin 2\.4\.21/)!.detail, /AGP 9\.4\.1（支援 8\.5\.2–9\.3\.1）/);
});

test('Android: JDK checks against the project AGP and the latest AGP', () => {
  assert.equal(find(checkProject({ jdk: '11', agp: '8.7.3' }, data, NOW).android, /JDK 11 無法執行 AGP 8\.7\.3/)?.status, 'urgent');
  assert.equal(find(checkProject({ jdk: '17', agp: '8.7.3' }, data, NOW).android, /JDK 17 符合/)?.status, 'ok');
});

test('Android: Play Billing deprecation and 16 KB page size', () => {
  const pbl7 = find(checkProject({ billing: '7.1.1' }, data, NOW).android, /Billing Library 7/);
  assert.equal(pbl7?.status, 'urgent');
  assert.equal(pbl7?.target, '9.1.0');
  assert.equal(find(checkProject({ billing: '6.2.1' }, data, NOW).android, /6 已停止支援/)?.status, 'urgent');
  assert.equal(find(checkProject({ billing: '8.0.0' }, data, NOW).android, /Billing Library 8/)?.status, 'upcoming');
  assert.equal(find(checkProject({ billing: '9.1.0' }, data, NOW).android, /不在淘汰名單/)?.status, 'ok');
  const pageSize = find(checkProject({ native: true }, data, NOW).android, /16 KB/);
  assert.equal(pageSize?.status, 'upcoming');
  assert.match(pageSize!.detail, /剩 113 天/);
});

test('results are sorted most urgent first, and the upgrade plan follows dependency order', () => {
  const { ios, android } = checkProject({ xcode: '16.4', macos: '15.6', deployment: '12', jdk: '11', agp: '8.7.3', gradle: '8.7', targetSdk: '35', billing: '7.1.1' }, data, NOW);
  for (const list of [ios, android]) {
    const ranks = list.map(i => ['urgent', 'upcoming', 'info', 'ok'].indexOf(i.status));
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  }
  assert.deepEqual(upgradePlan(ios, 'ios').map(s => `${s.label} ${s.target}`), ['macOS 26.6', 'Xcode 26', 'Deployment Target iOS 13']);
  assert.deepEqual(upgradePlan(android, 'android').map(s => s.label), ['JDK', 'Gradle', 'AGP', 'targetSdk', 'Play Billing']);
  assert.deepEqual(upgradePlan(checkProject({ xcode: '27', deployment: '16' }, data, NOW).ios, 'ios'), [], 'nothing to upgrade');
});
