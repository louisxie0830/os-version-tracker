import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchSecurityReport,
  inVersionRange,
  parseAdvisories,
  parseAndroidBulletin,
  parseAndroidBulletinIndex,
  parseAppleAdvisory,
  parseAppleSecurityReleases,
  parseKev,
} from '../src/fetchers/security.ts';
import { toTrackedItems } from '../src/changes.ts';

const now = new Date('2026-10-14T00:00:00Z');

// Synthetic markup in the layout of Apple's "Security releases" table
const APPLE_TABLE = `<table><tbody>
<tr><th>Name and information link</th><th>Available for</th><th>Release date</th></tr>
<tr><td><p>iOS 27.0.1 and iPadOS 27.0.1</p><p>This update has no published CVE entries.</p></td><td>iPhone 11 and later</td><td>28 Sep 2026</td></tr>
<tr><td><a href="https://support.apple.com/en-us/900001">iOS 26.7.1 and iPadOS 26.7.1</a></td><td>iPhone 11 and later</td><td>28 Sep 2026</td></tr>
<tr><td><a href="https://support.apple.com/en-us/900002">macOS Tahoe 26.7.1</a></td><td>macOS Tahoe</td><td>28 Sep 2026</td></tr>
<tr><td><a href="/en-us/900003">Safari 27</a></td><td>macOS</td><td>14 Sep 2026</td></tr>
<tr><td><a href="https://support.apple.com/en-us/900004">iOS 25.1</a></td><td>iPhone</td><td>01 Jan 2026</td></tr>
</tbody></table>`;

test('parseAppleSecurityReleases keeps recent iOS / Safari / Xcode rows with their advisory links', () => {
  assert.deepEqual(parseAppleSecurityReleases(APPLE_TABLE, now).map(r => [r.name, r.date, r.url]), [
    ['iOS 27.0.1 and iPadOS 27.0.1', '2026-09-28', undefined],
    ['iOS 26.7.1 and iPadOS 26.7.1', '2026-09-28', 'https://support.apple.com/en-us/900001'],
    ['Safari 27', '2026-09-14', 'https://support.apple.com/en-us/900003'],
  ]);
});

test('parseAppleAdvisory counts CVEs and picks the ones Apple says may have been exploited', () => {
  const html = `<h2>ImageIO</h2><p>Available for: iPhone 11 and later</p>
    <p>Impact: Processing a maliciously crafted file may lead to arbitrary code execution. Apple is aware of a report that this issue may have been exploited in an extremely sophisticated attack.</p>
    <p>Description: An out-of-bounds write was addressed.</p><p>CVE-2026-90001: Apple</p>
    <h2>WebKit</h2><p>Impact: Processing web content may lead to a crash.</p><p>Description: A memory issue was addressed.</p><p>CVE-2026-90002: a researcher</p>`;
  assert.deepEqual(parseAppleAdvisory(html), { cves: 2, exploited: ['CVE-2026-90001'] });
});

test('parseAndroidBulletinIndex and parseAndroidBulletin read dates, patch levels, severity and exploitation notes', () => {
  const index = `<table><tr><th>Bulletin</th><th>Languages</th><th>Published date</th><th>Security patch level</th></tr>
    <tr><td><a href="/docs/security/bulletin/2026/2026-10-01">October 2026</a></td><td>Translations coming soon</td><td>October 5, 2026</td><td>2026-10-01<br>2026-10-05</td></tr>
    <tr><td><a href="/docs/security/bulletin/2026/2026-09-01">September 2026</a></td><td>English</td><td>September 8, 2026</td><td>2026-09-01<br>2026-09-05</td></tr></table>`;
  assert.deepEqual(parseAndroidBulletinIndex(index, 1), [{
    title: 'Android Security Bulletin October 2026',
    url: 'https://source.android.com/docs/security/bulletin/2026/2026-10-01',
    published: '2026-10-05',
    patchLevels: ['2026-10-01', '2026-10-05'],
    exploited: [],
  }]);
  const bulletin = `<p>The most severe of these issues is a critical security vulnerability in the System component that could lead to remote code execution.</p>
    <p><strong>Note:</strong> There are indications that CVE-2026-91001 and CVE-2026-91002 may be under limited, targeted exploitation.</p>
    <table><tr><td>CVE-2026-91001</td></tr><tr><td>CVE-2026-91002</td></tr><tr><td>CVE-2026-91003</td></tr></table>`;
  assert.deepEqual(parseAndroidBulletin(bulletin), {
    cves: 3,
    mostSevere: 'a critical security vulnerability in the System component that could lead to remote code execution',
    exploited: ['CVE-2026-91001', 'CVE-2026-91002'],
  });
  // Some months publish a bulletin with no vulnerability sections at all
  assert.deepEqual(parseAndroidBulletin('<h2>Android and Google service mitigations</h2><h2>Common questions and answers</h2>'), { cves: 0, mostSevere: undefined, exploited: [] });
});

test('parseKev keeps recent phone / WebView entries, newest first', () => {
  const entry = (cveID: string, vendorProject: string, product: string, dateAdded: string) =>
    ({ cveID, vendorProject, product, dateAdded, vulnerabilityName: `${product} bug`, shortDescription: 'desc', knownRansomwareCampaignUse: 'Unknown' });
  const items = parseKev({ vulnerabilities: [
    entry('CVE-2026-1', 'Apple', 'Multiple Products', '2026-09-29'),
    entry('CVE-2026-2', 'Apple', 'macOS', '2026-09-28'),
    entry('CVE-2026-3', 'Google', 'Chromium V8', '2026-09-09'),
    entry('CVE-2026-4', 'Android', 'Framework', '2026-09-30'),
    entry('CVE-2026-5', 'Microsoft', 'Windows', '2026-09-30'),
    entry('CVE-2025-6', 'Apple', 'iOS', '2025-01-01'),
  ] }, now);
  assert.deepEqual(items.map(i => [i.cve, i.platform]), [['CVE-2026-4', 'Android'], ['CVE-2026-1', 'iOS'], ['CVE-2026-3', '跨平台']]);
  assert.equal(items[0].url, 'https://nvd.nist.gov/vuln/detail/CVE-2026-4');
});

test('parseAdvisories keeps tracked packages, drops withdrawn ones and sorts newest first', () => {
  const adv = (id: string, name: string, published: string, extra = {}) => ({
    ghsa_id: id, cve_id: null, html_url: `https://github.com/advisories/${id}`, summary: `${name} issue`, severity: 'high',
    published_at: `${published}T00:00:00Z`, vulnerabilities: [{ package: { ecosystem: 'npm', name } }], ...extra,
  });
  const items = parseAdvisories([
    adv('GHSA-1', 'com.squareup.okhttp3:okhttp', '2022-05-24'),
    adv('GHSA-2', 'cordova-plugin-inappbrowser', '2026-06-08', { severity: 'critical' }),
    adv('GHSA-3', 'left-pad', '2026-07-01'),
    adv('GHSA-4', 'react-native', '2026-08-01', { withdrawn_at: '2026-08-02T00:00:00Z' }),
    adv('GHSA-5', 'github.com/Alamofire/Alamofire', '2026-01-01', { severity: 'weird' }),
  ]);
  assert.deepEqual(items.map(i => [i.id, i.platform, i.severity]), [['GHSA-2', '跨平台', 'critical'], ['GHSA-5', 'iOS', 'unknown'], ['GHSA-1', 'Android', 'high']]);
});

test('security report keeps partial results and fails only when every source failed', async () => {
  const fail = () => Promise.reject(new Error('down'));
  const warn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(fetchSecurityReport({ apple: fail, android: fail, exploited: fail, advisories: fail }), /security: every upstream failed/);
    const partial = await fetchSecurityReport({ apple: fail, android: fail, exploited: () => Promise.resolve([]), advisories: fail });
    assert.deepEqual(partial, { apple: [], android: [], exploited: [], advisories: [] });
  } finally {
    console.warn = warn;
  }
});

test('toTrackedItems tracks exploited vulnerabilities, bulletins and recent serious SDK advisories', () => {
  const items = toTrackedItems({ deadlines: [], appleNews: [], androidNews: [], devices: [], security: {
    exploited: [{ cve: 'CVE-2026-1', platform: 'iOS', product: 'Apple iOS', name: 'n', dateAdded: '2026-09-29', description: '', ransomware: false, url: 'https://nvd.nist.gov/vuln/detail/CVE-2026-1' }],
    apple: [
      { name: 'iOS 26.7.1', url: 'https://support.apple.com/x', date: '2026-09-28', exploited: ['CVE-2026-1'] },
      { name: 'iOS 27', url: 'https://support.apple.com/y', date: '2026-09-14', exploited: [] },
    ],
    android: [{ title: 'Android Security Bulletin October 2026', url: 'https://source.android.com/b', published: '2026-10-05', patchLevels: ['2026-10-01', '2026-10-05'], exploited: [], cves: 25 }],
    advisories: [
      { id: 'GHSA-new', severity: 'critical', summary: 's', published: '2026-09-01', packages: ['p'], platform: '跨平台', url: 'https://github.com/advisories/GHSA-new' },
      { id: 'GHSA-old', severity: 'critical', summary: 's', published: '2020-01-01', packages: ['p'], platform: '跨平台', url: 'https://github.com/advisories/GHSA-old' },
      { id: 'GHSA-low', severity: 'low', summary: 's', published: '2026-09-01', packages: ['p'], platform: '跨平台', url: 'https://github.com/advisories/GHSA-low' },
    ],
  } }, now);
  assert.deepEqual(items.map(i => i.id), [
    'security:kev:CVE-2026-1',
    'security:apple:https://support.apple.com/x',
    'security:android:https://source.android.com/b',
    'security:ghsa:GHSA-new',
  ]);
  assert.match(items[2].title, /修補程式等級 2026-10-05/);
  assert.equal(items[2].detail, '25 個 CVE');
});

test('inVersionRange handles single and combined comparators', () => {
  assert.ok(inVersionRange('6.0.0', '< 6.0.1'));
  assert.ok(!inVersionRange('7.0.0', '< 6.0.1'));
  assert.ok(inVersionRange('2.3.0', '>= 2.0.0, < 2.4.1'));
  assert.ok(!inVersionRange('2.4.1', '>= 2.0.0, < 2.4.1'));
  assert.ok(inVersionRange('3.0.0', '<= 3.0.0'));
  assert.ok(inVersionRange('1.2.3', '= 1.2.3'));
  assert.ok(!inVersionRange('1.0.0', undefined));
  assert.ok(!inVersionRange('1.0.0', 'weird syntax'), 'unknown syntax is not treated as affected');
});

test('parseAdvisories keeps the affected range and first fix per tracked package', () => {
  const [a] = parseAdvisories([{
    ghsa_id: 'GHSA-x', cve_id: 'CVE-2026-1', html_url: 'https://github.com/advisories/GHSA-x', summary: 's', severity: 'critical', published_at: '2026-06-08T00:00:00Z',
    vulnerabilities: [
      { package: { ecosystem: 'npm', name: 'cordova-plugin-inappbrowser' }, vulnerable_version_range: '< 6.0.1', first_patched_version: '6.0.1' },
      { package: { ecosystem: 'npm', name: 'left-pad' }, vulnerable_version_range: '< 2.0.0', first_patched_version: '2.0.0' },
    ],
  }]);
  assert.deepEqual(a.ranges, [{ package: 'cordova-plugin-inappbrowser', vulnerable: '< 6.0.1', patched: '6.0.1' }]);
});
