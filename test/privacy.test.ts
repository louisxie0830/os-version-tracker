import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRIVACY_LINKS, parseRequiredReasonApis, parseSdksRequiringManifest } from '../src/fetchers/privacy.js';
import { fixture, GARBAGE_HTML } from './helpers.js';

test('parseRequiredReasonApis: the five categories with APIs and reason codes', () => {
  const cats = parseRequiredReasonApis(JSON.parse(fixture('apple-nsprivacyaccessedapitype.json')));
  assert.deepEqual(cats.map(c => c.category), ['File timestamp', 'System boot time', 'Disk space', 'Active keyboards', 'User defaults']);
  assert.deepEqual(cats.map(c => c.key), [
    'NSPrivacyAccessedAPICategoryFileTimestamp',
    'NSPrivacyAccessedAPICategorySystemBootTime',
    'NSPrivacyAccessedAPICategoryDiskSpace',
    'NSPrivacyAccessedAPICategoryActiveKeyboards',
    'NSPrivacyAccessedAPICategoryUserDefaults',
  ]);

  const defaults = cats[4];
  assert.deepEqual(defaults.apis, ['UserDefaults']);
  assert.deepEqual(defaults.reasons.map(r => r.code), ['CA92.1', '1C8F.1', 'C56D.1', 'AC6B.1']);
  // First paragraph only, with inline references resolved to their titles
  assert.equal(defaults.reasons[0].description, 'Test reason: read and write values that only this app can see via UserDefaults. Second paragraph, kept.', 'every paragraph: the later ones carry the conditions');
  assert.match(defaults.url, /^https:\/\/developer\.apple\.com\/documentation\/bundleresources\//);

  const boot = cats[1];
  assert.deepEqual(boot.apis, ['systemUptime', 'mach_absolute_time()']);
  assert.deepEqual(boot.reasons.map(r => r.code), ['35F9.1', '8FFB.1', '3D61.1']);
  assert.ok(cats[0].apis.includes('creationDate'));
  assert.deepEqual(cats[0].reasons.map(r => r.code), ['DDA9.1', 'C617.1', '3B52.1', '0A2A.1']);
});

test('parseSdksRequiringManifest: Apple third-party SDK list', () => {
  const sdks = parseSdksRequiringManifest(fixture('apple-third-party-sdk-requirements.html'));
  assert.equal(sdks.length, 86);
  assert.deepEqual(sdks.slice(0, 5), ['Abseil', 'AFNetworking', 'Alamofire', 'AppAuth', 'BoringSSL / openssl_grpc']);
  for (const name of ['FirebaseCrashlytics', 'Flutter', 'hermes', 'RealmSwift', 'webview_flutter_wkwebview']) {
    assert.ok(sdks.includes(name), name);
  }
});

test('privacy parsers return nothing for unrelated content', () => {
  assert.deepEqual(parseRequiredReasonApis({}), []);
  assert.deepEqual(parseSdksRequiringManifest(GARBAGE_HTML), []);
});

test('PRIVACY_LINKS are official https links with notes for both platforms', () => {
  for (const l of PRIVACY_LINKS) {
    assert.match(l.url, /^https:\/\/(developer\.apple\.com|play\.google\.com|support\.google\.com|developer\.android\.com)\//);
    assert.ok(l.title && l.note);
  }
  assert.ok(PRIVACY_LINKS.some(l => l.platform === 'ios'));
  assert.ok(PRIVACY_LINKS.some(l => l.platform === 'android'));
});

test('parseSdksRequiringManifest: the list under the heading, and only a list long enough to be Apple\'s', () => {
  const sdks = Array.from({ length: 25 }, (_, i) => `<li>SDK${i}</li>`).join('');
  const html = `<meta content="SDKs that require a privacy manifest"><nav><ul><li>Home</li><li>News</li></ul></nav><h2>SDKs that require a privacy manifest and signature</h2><ul>${sdks}</ul>`;
  const list = parseSdksRequiringManifest(html);
  assert.equal(list.length, 25);
  assert.equal(list[0], 'SDK0', 'not the navigation');
  assert.deepEqual(parseSdksRequiringManifest('<h2>SDKs that require a privacy manifest</h2><ul><li>Intro</li><li>More</li></ul>'), [], 'two items is an intro list, not the SDK list');
});
