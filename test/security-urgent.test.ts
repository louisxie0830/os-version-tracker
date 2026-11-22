import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exploitedCves, parseChromeStable, parseMediatekBulletin, parseMediatekIndex, parseSamsungUpdates } from '../src/fetchers/vendor-security.ts';
import { parseAndroidBulletinIndex } from '../src/fetchers/security.ts';
import type { SecurityReport } from '../src/fetchers/security.ts';
import { githubReleaseItems, type DevNewsItem } from '../src/fetchers/dev-news.ts';
import { urgentSecurityItems } from '../src/security-urgent.ts';
import { issueBody, MAX_PER_RUN, sendSecurityIssues, sentKeys, toSend } from '../src/security-alerts.ts';

/**
 * The vendor parsers (Chrome Releases, Pixel, Samsung, MediaTek) against markup in each site's layout, the
 * "需要立即處理" list and its windows, and the alert issues (sent once per item, a few per run).
 */

const NOW = new Date('2026-11-22T00:00:00Z');

// ---------- vendor parsers ----------

test('exploitedCves: only CVEs in sentences that say they are exploited, not "not aware of any"', () => {
  assert.deepEqual(exploitedCves('Google is aware that an exploit for CVE-2026-1111 exists in the wild. CVE-2026-2222: Use after free in V8.'), ['CVE-2026-1111']);
  assert.deepEqual(exploitedCves('There are indications that CVE-2026-3 may be under limited, targeted exploitation.'), ['CVE-2026-3'].filter(() => false), 'a CVE id needs four digits after the year');
  assert.deepEqual(exploitedCves('There are indications that CVE-2026-3333 may be under limited, targeted exploitation.'), ['CVE-2026-3333']);
  assert.deepEqual(exploitedCves('At this time, we are not aware of any active exploitation of these vulnerabilities in the wild. CVE-2026-4444'), []);
});

test('parseChromeStable: desktop stable posts only, version, fix counts and exploits; http links become https', () => {
  const post = (title: string, content: string, date = '2026-11-17T20:00:00.000Z') => ({ title, link: 'http://chromereleases.googleblog.com/2026/11/x.html', content, isoDate: date, published: '2026-11-17T12:00:00.000-08:00' });
  const items = parseChromeStable([
    post('Stable Channel Update for Desktop', '<p>Chrome 158.0.8127.36 (Linux) contains fixes. This update includes 204 security fixes.</p> [N/A][1] Critical CVE-2026-130963: Use after free in WebView. [N/A][2] High CVE-2026-130964: x. Google is aware that an exploit for CVE-2026-130963 exists in the wild.'),
    post('Chrome for Android Update', 'Chrome 159 (159.0.8154.18) for Android'),
    post('Stable Channel Update for Desktop', 'no version here'),
    post('Stable Channel Update for Desktop', 'The Stable channel has been updated to 157.0.8103.78 for Windows.', '2026-11-11T20:00:00.000Z'),
  ]);
  assert.deepEqual(items.map(i => [i.version, i.published, i.fixes, i.critical, i.exploited, i.url.startsWith('https://')]), [
    ['158.0.8127.36', '2026-11-17', 204, 1, ['CVE-2026-130963'], true],
    ['157.0.8103.78', '2026-11-17', undefined, 0, [], true],
  ]);
});

test('Pixel bulletins read through the Android index parser, with their own address and title', () => {
  const html = `<table><tr><th>Bulletin</th><th>Languages</th><th>Published date</th><th>Security patch level</th></tr>
    <tr><td><a href="/docs/security/bulletin/pixel/2026/2026-11-01">November 2026</a></td><td>-</td><td>November 10, 2026</td><td>2026-11-05</td></tr></table>`;
  const [b] = parseAndroidBulletinIndex(html, 2, 'https://source.android.com/docs/security/bulletin/pixel', 'Pixel Update Bulletin');
  assert.deepEqual([b.title, b.url, b.published, b.patchLevels], ['Pixel Update Bulletin November 2026', 'https://source.android.com/docs/security/bulletin/pixel/2026/2026-11-01', '2026-11-10', ['2026-11-05']]);
});

test('parseSamsungUpdates: one entry per month, CVEs by severity ("not applicable" left out), newest first', () => {
  const month = (name: string, body: string) => `<div class="acc_title" id="x" data-a="1"><a href="javascript:;" title="Detail view open">${name}</a></div>
    <div class="acc_sub"><font size="3">${body}</font></div>`;
  const html = month('SMR-OCT-2026', '<strong><font size="4">Critical</font></strong><br />CVE-2026-1001<br /><strong><font size="4">High</font></strong><br />CVE-2026-1002, CVE-2026-1003')
    + month('SMR-NOV-2026', '<strong><font size="4">Critical</font></strong><br />CVE-2026-2001, CVE-2026-2002<br /><br /><strong><font size="4">Not applicable to Samsung devices</font></strong><br />CVE-2026-2999<br />SVE-2026-1 may be under limited, targeted exploitation (CVE-2026-2002).')
    + month('SMR-XYZ-2026', 'ignored');
  const updates = parseSamsungUpdates(html, 5);
  assert.deepEqual(updates.map(u => [u.title, u.url, u.published, u.cves, u.critical, u.exploited]), [
    ['Samsung Security Maintenance Release SMR-NOV-2026', 'https://security.samsungmobile.com/securityUpdate.smsb#SMR-NOV-2026', '2026-11-01', 2, 2, ['CVE-2026-2002']],
    ['Samsung Security Maintenance Release SMR-OCT-2026', 'https://security.samsungmobile.com/securityUpdate.smsb#SMR-OCT-2026', '2026-10-01', 3, 1, []],
  ]);
});

test('parseMediatekIndex and parseMediatekBulletin: month cards with dates, severity counts, exploitation', () => {
  const card = (month: string, date: string, slug: string) => `<div class="col_card_inner"><div class="annual_year"><div class="title_wrap">
      ${month}
    </div><div class="date_wrap"><span class="pub">Published: </span><span class="date">${date}</span></div></div>
    <div class="annual_pdf"><a href="https://www.mediatek.com/product-security-bulletin/${slug}?hsLang=en"><i></i></a></div></div>`;
  const index = parseMediatekIndex(card('October', '2026-10-05', 'october-2026') + card('November', '2026-11-02', 'november-2026'));
  assert.deepEqual(index.map(b => [b.title, b.url, b.published]), [
    ['MediaTek Product Security Bulletin November 2026', 'https://www.mediatek.com/product-security-bulletin/november-2026', '2026-11-02'],
    ['MediaTek Product Security Bulletin October 2026', 'https://www.mediatek.com/product-security-bulletin/october-2026', '2026-10-05'],
  ]);
  const page = (note: string) => `<p>${note}</p><h3>Summary</h3><table><tr><th>Severity</th><th>CVEs</th></tr>
    <tr><td>Critical</td><td>CVE-2026-20499 , CVE-2026-20545</td></tr><tr><td>High</td><td>CVE-2026-20550</td></tr></table><h3>Details</h3><p>CVE-2026-20499 again</p>`;
  assert.deepEqual(parseMediatekBulletin(page('At this time, we are not aware of any active exploitation of these vulnerabilities in the wild.')), { cves: 3, critical: 2, exploited: [] });
  assert.deepEqual(parseMediatekBulletin(page('CVE-2026-20545 is being actively exploited.')).exploited, ['CVE-2026-20545']);
});

// ---------- the urgent list ----------

const report = (over: Partial<SecurityReport> = {}): SecurityReport => ({ apple: [], android: [], exploited: [], advisories: [], ...over });
const news = (id: string, date: string, important = true, category: DevNewsItem['category'] = 'security'): DevNewsItem =>
  ({ id: `${id}:https://x/${id}/${date}`, source: id, platform: '跨平台', category, title: `${id} ${date}`, url: `https://x/${id}/${date}`, date, important });

test('githubReleaseItems: published releases only, named or tagged', () => {
  assert.deepEqual(githubReleaseItems([
    { tag_name: 'v2.1.0', name: 'v2.1.0', html_url: 'https://github.com/OWASP/masvs/releases/tag/v2.1.0', published_at: '2024-01-18T11:15:29Z' },
    { tag_name: 'v3.0.0-rc1', name: '', html_url: 'https://x', published_at: '2026-11-01T00:00:00Z', prerelease: true },
    { tag_name: 'v3.0.0', name: '', html_url: 'https://github.com/OWASP/masvs/releases/tag/v3.0.0', published_at: '2026-11-20T00:00:00Z' },
    { tag_name: 'draft', html_url: 'https://x', published_at: null, draft: true },
  ]), [
    { title: 'v2.1.0', link: 'https://github.com/OWASP/masvs/releases/tag/v2.1.0', isoDate: '2024-01-18T11:15:29Z' },
    { title: 'v3.0.0', link: 'https://github.com/OWASP/masvs/releases/tag/v3.0.0', isoDate: '2026-11-20T00:00:00Z' },
  ]);
  assert.throws(() => githubReleaseItems({}), /not a JSON array/);
});

test('urgentSecurityItems: exploited items, fixes and serious advisories within their windows, each with an action', () => {
  const items = urgentSecurityItems({
    security: report({
      exploited: [
        { cve: 'CVE-2026-9001', platform: '跨平台', product: 'Google Chromium', name: 'UAF', dateAdded: '2026-11-10', description: '', ransomware: false, url: 'https://nvd/1' },
        { cve: 'CVE-2026-9002', platform: 'iOS', product: 'Apple iOS', name: 'old', dateAdded: '2026-10-01', description: '', ransomware: false, url: 'https://nvd/2' },
      ],
      apple: [{ name: 'iOS 27.2.1', url: 'https://support.apple.com/1', date: '2026-11-09', exploited: ['CVE-2026-9003'] }, { name: 'iOS 27.2', date: '2026-11-01', exploited: ['CVE-2026-9004'] }],
      chrome: [{ version: '158.0.8127.36', url: 'https://chrome/1', published: '2026-11-17', critical: 1, exploited: ['CVE-2026-9005'] }, { version: '157.0.1.1', url: 'https://chrome/2', published: '2026-11-11', critical: 0, exploited: [] }],
      android: [{ title: 'Android Security Bulletin November 2026', url: 'https://asb/1', published: '2026-11-03', patchLevels: ['2026-11-01', '2026-11-05'], exploited: ['CVE-2026-9006'] }],
      vendors: [
        { vendor: 'MediaTek', title: 'MediaTek November', url: 'https://mtk/1', published: '2026-11-02', exploited: ['CVE-2026-9007'] },
        { vendor: 'Samsung', title: 'Samsung SMR-NOV-2026', url: 'https://sam/1', published: '2026-11-01', exploited: [] },
      ],
      advisories: [
        { id: 'GHSA-1', severity: 'critical', summary: 'okhttp bug', published: '2026-11-15', packages: ['com.squareup.okhttp3:okhttp'], ranges: [{ package: 'com.squareup.okhttp3:okhttp', vulnerable: '< 5.1.0', patched: '5.1.0' }], platform: 'Android', url: 'https://ghsa/1' },
        { id: 'GHSA-2', severity: 'medium', summary: 'minor', published: '2026-11-15', packages: ['dio'], ranges: [], platform: '跨平台', url: 'https://ghsa/2' },
      ],
    }),
    devNews: [news('acs', '2026-11-21'), news('acs', '2026-11-01'), news('acs', '2026-11-20', false), news('google-security', '2026-11-19')],
  }, NOW);
  assert.deepEqual(items.map(i => i.key), [
    'notice:https://x/acs/2026-11-21', 'chrome:158.0.8127.36', 'ghsa:GHSA-1', 'kev:CVE-2026-9001', 'apple:https://support.apple.com/1',
    'android:https://asb/1', 'vendor:https://mtk/1',
  ], 'newest first; old KEV, no-link Apple fix, unexploited updates, medium advisories, old / unimportant / non-Taiwan notices left out');
  const by = (key: string) => items.find(i => i.key === key)!;
  assert.match(by('chrome:158.0.8127.36').action, /Android System WebView 更新到 158\.0\.8127\.36 以上/);
  assert.match(by('ghsa:GHSA-1').action, /okhttp 升級到 5\.1\.0 以上/);
  assert.match(by('kev:CVE-2026-9001').action, /Android System WebView/);
  assert.match(by('android:https://asb/1').action, /2026-11-05 以上/);
  assert.match(by('vendor:https://mtk/1').action, /手機廠商隨系統更新推送/);
  assert.deepEqual(urgentSecurityItems({ security: null, devNews: [] }, NOW), []);
});

// ---------- alert issues ----------

const item = (key: string, date: string) => ({ key, platform: 'iOS' as const, source: 'S', title: `T ${key}`, action: 'A', url: 'https://u', date });

test('toSend: new and recent only, oldest first, a few per run', () => {
  const items = [item('a', '2026-11-21'), item('b', '2026-11-10'), item('c', '2026-11-20'), ...Array.from({ length: 6 }, (_, i) => item(`n${i}`, '2026-11-19'))];
  const picked = toSend(items, new Set(['c']), NOW);
  assert.equal(picked.length, MAX_PER_RUN);
  assert.equal(picked[0].date, '2026-11-19', 'oldest first');
  assert.ok(!picked.some(i => i.key === 'b' || i.key === 'c'), 'older than 7 days, or already sent');
});

test('sendSecurityIssues: reads what was sent from the issues, opens one issue per new item with its key', async () => {
  const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
  const gh = async (path: string, _token: string, init: { method?: string; body?: unknown } = {}) => {
    calls.push({ path, ...init });
    if (!init.method) return { ok: true, status: 200, data: [{ body: issueBody(item('old', '2026-11-20'), '') }, { body: null }] };
    const failed = String((init.body as { title: string }).title).includes('fail');
    return { ok: !failed, status: failed ? 422 : 201, data: {} };
  };
  const sent = await sendSecurityIssues([item('old', '2026-11-20'), item('new', '2026-11-21'), item('fail', '2026-11-21')], { repo: 'o/r', token: 't' }, 'https://site', NOW, gh);
  assert.deepEqual(sent, ['new'], 'already sent skipped; a failed issue is not counted');
  const posts = calls.filter(c => c.method === 'POST');
  assert.equal(posts.length, 2);
  const body = (posts.find(p => (p.body as { title: string }).title === '[資安] T new')!.body as { body: string; labels: string[] });
  assert.deepEqual(body.labels, ['security-alert']);
  assert.match(body.body, /\*\*建議動作：\*\*A/);
  assert.match(body.body, /網站：https:\/\/site\/#security/);
  assert.match(body.body, /<!-- security-key: new -->/);
  assert.match(calls[0].path, /^\/repos\/o\/r\/issues\?labels=security-alert&state=all&per_page=100&page=1$/);
});

test('sentKeys: a failed list stops everything (sending blind could repeat every item); pages until a short page', async () => {
  await assert.rejects(sentKeys('o/r', 't', async () => ({ ok: false, status: 403, data: null })), /HTTP 403/);
  let pages = 0;
  const keys = await sentKeys('o/r', 't', async () => {
    pages++;
    return { ok: true, status: 200, data: Array.from({ length: pages === 1 ? 100 : 3 }, (_, i) => ({ body: `<!-- security-key: k${pages}-${i} -->` })) };
  });
  assert.equal(pages, 2);
  assert.equal(keys.size, 103);
});
