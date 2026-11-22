import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { appleFindings, androidFindings, parseEpss, parseFinancialIndex, financialDetail, financialTimeline, securityFindings, FISAC_URL } from '../src/security-intelligence.ts';
import { fetchSecurityReport, fetchFinancialNotices, fetchEpss, versionRangeStatus, type SecurityReport } from '../src/fetchers/security.ts';
import { resetLastGood } from '../src/last-good.ts';
import { renderSecurityCenter } from '../src/render-security-center.ts';
import type { AllVersions } from '../src/fetch-all.ts';
import { readFileSync } from 'node:fs';

const at = new Date('2026-11-22T04:00:00Z');
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; resetLastGood(); });
const empty = (): SecurityReport => ({ apple: [], android: [], exploited: [], advisories: [] });
const detail = `<p>TLP：(White)</p><p>更新時間：2026/11/18</p><p>發佈時間：2023/03/06</p><p>更新說明：新增「疑似偽冒範例銀行」 hxxps://one[.]invalid/ hxxps://two.invalid/（2026年11月18日更新：連結已失效）</p><p>建議措施：無</p><table><tr><td>URL</td><td>https://not-an-indicator.invalid/</td></tr></table>`;
const index = `<h1>情資總覽</h1><table><tr><td>2026/11/18</td><td>FISAC-400-202303-0002</td><td><a href="/STIX_CASE/QueryStixCase/Detail?Uno=test&amp;public=1">偽冒金融機構通報</a></td></tr></table>`;

test('Apple repair evidence is kept by product branch and CVE, with explicit availability and exploitation notes', () => {
  const html = '<h2>WebKit</h2><p>Available for: iPhone 11 and later</p><p>Impact: This issue may have been exploited.</p><p>CVE-2026-12345</p><h2>Kernel</h2><p>CVE-2026-12346</p>';
  const rows = appleFindings(html, { name: 'iOS 27.1', date: '2026-11-18', url: 'https://support.apple.com/x' });
  assert.match(rows[0].affected ?? '', /更新適用裝置：iPhone 11 and later/);
  assert.equal(rows[0].component, 'WebKit'); assert.equal(rows[0].fixed, 'iOS 27.1'); assert.equal(rows[0].exploited, true);
  assert.equal(rows[1].exploited, false);
  assert.equal(appleFindings(html, { name: 'Safari 27.1', date: '2026-11-18', url: 'https://support.apple.com/y' })[0].platform, '跨平台');
  assert.deepEqual(appleFindings(html, { name: 'iOS 27.1', date: '2026-11-18' }), []);
});

test('Android maps each CVE to the preceding patch-level section and its own AOSP column', () => {
  const html = `<h2>2026-11-01 security patch level vulnerability details</h2><h3>Framework</h3><table><tr><th>CVE</th><th>Severity</th><th>Updated AOSP versions</th></tr><tr><td>CVE-2026-12345</td><td>Critical</td><td>15, 16, 17</td></tr></table><h2>2026-11-05 security patch level vulnerability details</h2><h3>Kernel</h3><table><tr><th>CVE</th><th>Severity</th></tr><tr><td>CVE-2026-12346</td><td>High</td></tr></table><table><tr><th>Other</th></tr></table>`;
  const rows = androidFindings(html, { url: 'https://source.android.com/x', published: '2026-11-05', exploited: ['CVE-2026-12345'] });
  assert.equal(rows.length, 2); assert.equal(rows[0].fixed, '安全修補等級 2026-11-01');
  assert.equal(rows[0].affected, '15, 16, 17'); assert.equal(rows[0].exploited, true);
  assert.equal(rows[1].fixed, '安全修補等級 2026-11-05'); assert.equal(rows[1].component, 'Kernel'); assert.equal(rows[1].affected, undefined);
  assert.equal(androidFindings('<table><tr><th>CVE</th></tr><tr><td>CVE-2026-12345</td></tr></table>', { url: 'https://source.android.com/x', published: '', exploited: [] })[0].fixed, undefined);
});

test('EPSS validates its structure and numbers, and preserves the score date rather than substituting fetch time', () => {
  const valid = { cve: 'CVE-2026-12345', epss: '0.1', percentile: '0.9', date: '2026-11-21' };
  assert.deepEqual(parseEpss({ status: 'OK', data: [valid, { ...valid, epss: null }, { ...valid, percentile: '2' }, { ...valid, date: '' }, { ...valid, cve: 'invalid' }] }), [{ cve: valid.cve, score: 0.1, percentile: 0.9, date: valid.date }]);
  assert.throws(() => parseEpss({}), /unexpected/); assert.throws(() => parseEpss(null), /unexpected/);
});

test('F-ISAC imports only public same-origin notices and defangs latest indicators; it never promotes historical URLs to malicious indicators', () => {
  const notices = parseFinancialIndex(index + `<table><tr><td>2026/11/18 偽冒</td><td><a href="https://other.invalid/STIX_CASE/QueryStixCase/Detail?Uno=evil">偽冒網站</a></td></tr><tr><td>2026/11/18 偽冒</td><td><a href="/STIX_CASE/QueryStixCase/Detail?Uno=empty">詳細</a></td></tr></table>`, at.toISOString());
  assert.equal(notices.length, 1); assert.equal(notices[0].url, 'https://www.fisac.tw/STIX_CASE/QueryStixCase/Detail?Uno=test&public=1');
  const parsed = financialDetail(detail, notices[0]);
  assert.equal(parsed.published, '2023-03-06'); assert.equal(parsed.updated, '2026-11-18');
  assert.deepEqual(parsed.indicators, [{ value: 'hxxps://one[.]invalid/', reportedStatus: 'unknown' }, { value: 'hxxps://two[.]invalid/', reportedStatus: 'inactive' }]);
  assert.throws(() => financialDetail(detail.replace('White', 'Amber'), notices[0]), /public TLP/);
  assert.throws(() => parseFinancialIndex('<p>Sign in</p>', ''), /not found/);
  assert.deepEqual(parseFinancialIndex('<h1>情資總覽</h1><table></table>', ''), []);
});

test('financial timeline retains first observation across updates and keeps regulatory notices distinct from incident conclusions', () => {
  const notices = parseFinancialIndex(index, '2026-11-18T00:00:00Z');
  const news = [{ id: 'banking-penalty:1', title: '範例銀行個資安全裁罰', source: '銀行局裁罰', platform: '跨平台' as const, category: 'security' as const, date: '2026-11-20', url: 'https://www.banking.gov.tw/test', important: true }];
  const first = financialTimeline(news, notices, [], at.toISOString());
  assert.equal(first[0].kind, 'regulatory');
  const later = financialTimeline(news, [{ ...notices[0], updated: '2026-11-22' }], first, '2026-11-23T00:00:00Z');
  assert.equal(later.length, 2); assert.equal(later[0].observedAt, '2026-11-18T00:00:00Z');
  assert.equal('breached' in later[0], false);
});

test('historical KEV stays actionable and enriches matching repair rows without mutating the original data', () => {
  const report = empty();
  report.apple = [{ name: 'iOS 27.1', date: '2026-11-18', exploited: [], findings: [{ id: 'CVE-2026-12345', cve: 'CVE-2026-12345', product: 'iOS 27.1', platform: 'iOS', exploited: false, date: '2026-11-18', url: 'https://support.apple.com/x' }] }];
  report.kevArchive = ['CVE-2026-12345', 'CVE-2020-12345'].map(cve => ({ cve, platform: 'iOS', product: 'Apple iOS', name: '', dateAdded: '2020-01-01', description: '', ransomware: false, url: 'https://nvd.nist.gov/x' }));
  const findings = securityFindings(report);
  assert.equal(findings.length, 2); assert.equal(findings[0].exploited, true); assert.equal(report.apple[0].findings![0].exploited, false);
  assert.deepEqual(securityFindings(null), []);
  report.advisories.push({ id: 'GHSA-test', severity: 'high', summary: '', published: '2026-11-19', packages: ['cordova-ios'], ranges: [{ package: 'cordova-ios', vulnerable: '< 7.0.0', patched: '7.0.0' }], platform: 'iOS', url: 'https://github.com/advisories/x', cvss: 8.1 });
  assert.equal(securityFindings(report).find(f => f.id === 'GHSA-test')?.cvss, 8.1);
});

test('security source states distinguish empty, partial and cached failures, including EPSS failures', async () => {
  resetLastGood();
  const fail = async (): Promise<never> => { throw new Error('down'); };
  const base = { apple: async () => [{ name: 'iOS 27.1', date: '2026-11-18', exploited: [], detailStatus: 'failed' as const }], android: async () => [], exploited: async () => [], advisories: async () => [], financial: async () => [], epss: fail };
  const partial = await fetchSecurityReport(base, at);
  assert.equal(partial.subsources?.find(s => s.id === 'apple')?.status, 'partial');
  assert.equal(partial.subsources?.find(s => s.id === 'android')?.status, 'ok');
  assert.equal(partial.subsources?.find(s => s.id === 'epss')?.status, 'failed');
  const cached = await fetchSecurityReport({ apple: fail, android: fail, exploited: fail, advisories: fail }, new Date(at.getTime() + 1000));
  assert.equal(cached.subsources?.find(s => s.id === 'android')?.lastSuccessAt, at.toISOString());
  resetLastGood();
  await assert.rejects(fetchSecurityReport({ apple: fail, android: fail, exploited: fail, advisories: fail }, at), /every upstream failed/);
});

test('bounded EPSS and financial requests do not follow indicators and preserve index metadata on a detail failure', async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url));
    if (String(url).startsWith('https://api.first.org/')) return Response.json({ status: 'OK', data: [] });
    return new Response(String(url) === FISAC_URL ? index : 'Forbidden', { status: String(url) === FISAC_URL ? 200 : 403 });
  }) as typeof fetch;
  await fetchEpss([...Array.from({ length: 150 }, (_, i) => `CVE-2026-${10000 + i}`), 'invalid']);
  assert.equal(urls.length, 2); assert.ok(urls.every(u => (new URL(u).searchParams.get('cve')?.split(',').length ?? 0) <= 50));
  const notices = await fetchFinancialNotices();
  assert.equal(notices.length, 1); assert.equal(notices[0].detailStatus, 'failed');
  assert.ok(urls.every(u => /api\.first\.org|www\.fisac\.tw/.test(new URL(u).hostname)));
});

test('unknown ranges and prereleases return pending instead of not affected', () => {
  assert.equal(versionRangeStatus('1.2.3', '< 1.3.0'), true);
  assert.equal(versionRangeStatus('1.2.3', '> 2.0.0 || = 1.2.3'), true);
  assert.equal(versionRangeStatus('1.2.3', '> 2.0.0 || = 1.0.0'), false);
  assert.equal(versionRangeStatus('1.2.3-beta', '< 1.3.0'), null);
  assert.equal(versionRangeStatus('1.2.3', '^1.2.0'), null);
  assert.equal(versionRangeStatus('1.2.3', undefined), null);
});

test('security center renders all eight views, old snapshots honestly, and escapes evidence including embedded JSON', () => {
  const data = JSON.parse(readFileSync(new URL('./fixtures/all-versions.json', import.meta.url), 'utf8')) as AllVersions;
  const report = empty();
  report.subsources = [{ id: 'test', label: '<script>x</script>', url: 'javascript:alert(1)', status: 'failed', checkedAt: at.toISOString(), count: 0, error: '<img src=x onerror=alert(1)>' }];
  report.financialNotices = [{ id: '</script>', title: '<script>x</script>', source: 'Official', url: 'javascript:alert(1)', updated: '2026-11-22', observedAt: at.toISOString(), kind: 'phishing' }];
  const html = renderSecurityCenter({ ...data, security: report }, '<p>Existing cards</p>');
  assert.equal(html.match(/role="tabpanel"/g)?.length, 8); assert.match(html, /Existing cards/);
  assert.doesNotMatch(html, /href="javascript:|<script>x|<img src=x/);
  assert.match(html, /\\u003c\/script>/); assert.match(html, /抓取失敗/);
  assert.match(renderSecurityCenter({ ...data, security: null }, ''), /舊版快照未記錄/);
});
