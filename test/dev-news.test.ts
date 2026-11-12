import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { androidxTitle, decodeFeedBody, fetchDevNews, fscTitle, mergeNews, NEWS_SOURCES, parseSourceItems, securityPlatform, TW_FIN_SECURITY, type DevNewsItem, TVN_MOBILE_FIN, acsPressItems, BANK_PENALTY_SECURITY } from '../src/fetchers/dev-news.ts';
import { rememberNews, resetHistoryState, forgetOtherNews } from '../src/history.ts';

const source = (id: string) => NEWS_SOURCES.find(s => s.id === id)!;

test('decodeFeedBody handles gzip bytes without a Content-Encoding header and a BOM', () => {
  const xml = '<?xml version="1.0"?><feed></feed>';
  assert.equal(decodeFeedBody(gzipSync(Buffer.from(xml))), xml);
  assert.equal(decodeFeedBody(Buffer.from(`﻿${xml}`)), xml);
});

test('AndroidX entries are titled by their libraries, stable releases first', () => {
  const content = '<ul><li><a href="x">Compose Animation Version 1.13.0-beta01</a></li><li><a href="y">Collection Version 1.7.0</a></li>'
    + '<li><a href="z">Paging Version 3.5.2</a></li><li><a href="w">Room Version 2.9.0-alpha02</a></li></ul>';
  assert.deepEqual(androidxTitle({ content, link: 'https://developer.android.com/x' }), {
    title: 'AndroidX: Collection 1.7.0, Paging 3.5.2, Compose Animation 1.13.0-beta01 +1 more',
    url: 'https://developer.android.com/x',
  });
  assert.equal(androidxTitle({ content: '<p>nothing</p>' }), null);
});

test('parseSourceItems filters, flags importance and drops unsafe or undated items', () => {
  const apple = parseSourceItems(source('apple-releases'), [
    { title: 'Xcode 27 (27A266a)', link: 'https://developer.apple.com/r/1', isoDate: '2026-09-14T00:00:00Z' },
    { title: 'iOS 27.2 beta 3 (24B5099f)', link: 'https://developer.apple.com/r/2', isoDate: '2026-10-05T00:00:00Z' },
    { title: 'macOS 27.2 beta 3 (26B5101f)', link: 'https://developer.apple.com/r/3', isoDate: '2026-10-05T00:00:00Z' },
    { title: 'iOS 27.1 (24B10)', link: 'javascript:alert(1)', isoDate: '2026-10-01T00:00:00Z' },
    { title: 'TestFlight Update', link: 'https://developer.apple.com/r/4' },
  ]);
  assert.deepEqual(apple.map(i => [i.title, i.important]), [['Xcode 27 (27A266a)', true], ['iOS 27.2 beta 3 (24B5099f)', false]]);

  const studio = parseSourceItems(source('android-studio'), [
    { title: 'Android Studio Rabbit 1 now available', link: 'https://a.example/1', isoDate: '2026-10-01T00:00:00Z' },
    { title: 'Android Studio Rabbit 2 Canary 4 now available', link: 'https://a.example/2', isoDate: '2026-10-08T00:00:00Z' },
  ]);
  assert.deepEqual(studio.map(i => i.important), [true, false]);

  const firebase = parseSourceItems(source('firebase'), [
    { title: 'Google Analytics for Firebase iOS SDK outage on September 28, 2026', link: 'https://firebase.blog/x', isoDate: '2026-10-02T00:00:00Z' },
  ]);
  assert.equal(firebase[0].important, true, 'outages are flagged by the shared rules');
  assert.equal(firebase[0].platform, '跨平台');
});

test('security feeds: platform from the title, their own importance rules and desktop-only research dropped', () => {
  const google = parseSourceItems(source('google-security'), [
    { title: 'Protecting Chrome and Android Users from Compromised eMudhra Intermediate CA Certificates', link: 'https://blog.google/security/a/', pubDate: 'Tue, 20 Oct 2026 19:49:00 +0000' },
    { title: 'Expanding Transparency: Google & Alphabet VRP Disclosure Policy Update', link: 'https://blog.google/security/b/', pubDate: 'Thu, 19 Nov 2026 14:45:00 +0000' },
    { title: 'Our latest defenses against evolving web scams', link: 'https://blog.google/security/c/', pubDate: 'Tue, 20 Oct 2026 17:00:00 +0000' },
  ]);
  assert.deepEqual(google.map(i => [i.platform, i.category, i.important]), [['Android', 'security', true], ['跨平台', 'security', true], ['跨平台', 'security', false]]);

  const github = parseSourceItems(source('github-security'), [
    { title: 'How bug bounty sharpens one researcher’s security skills', link: 'https://github.blog/security/x/', pubDate: 'Thu, 22 Oct 2026 17:21:30 +0000' },
  ]);
  assert.equal(github[0].important, false, 'a title saying "security" is not enough here');

  const zero = parseSourceItems(source('project-zero'), [
    { title: 'Windows Exploitation Techniques: Dangling COM Object Registrations', link: 'https://projectzero.google/1.html', published: '2026-09-21T00:00:00-07:00' },
    { title: 'A 0-click exploit chain for the Pixel 10', link: 'https://projectzero.google/2.html', published: '2026-05-13T00:00:00-07:00' },
    { title: 'Exploiting a WebKit bug on iOS and Android', link: 'https://projectzero.google/3.html', published: '2026-05-14T00:00:00-07:00' },
  ]);
  assert.deepEqual(zero.map(i => [i.platform, i.important]), [['Android', true], ['跨平台', false]]);
  assert.equal(securityPlatform('Safari and iPhone hardening'), 'iOS');
  assert.equal(parseSourceItems(source('project-zero'), [{ title: 'Policy and Disclosure: 2026 Edition', link: 'https://projectzero.google/4.html', published: '2026-11-13T00:00:00-08:00' }])[0].important, true);
});

const item = (id: string, date: string, url = `https://example.com/${id}`): DevNewsItem =>
  ({ id, source: id.split(':')[0], platform: 'iOS', category: 'blog', title: id, url, date, important: false });

test('mergeNews: the same security title from two authorities shows once; other items are told apart by URL', () => {
  const item = (id: string, url: string, title: string, category: DevNewsItem['category']): DevNewsItem =>
    ({ id: `${id}:${url}`, source: id, platform: '跨平台', category, title, url, date: '2026-11-20', important: false });
  const merged = mergeNews([
    [item('fsc', 'https://www.fsc.gov.tw/1', '金管會提醒防詐', 'security')],
    [item('banking-news', 'https://www.banking.gov.tw/1', '金管會提醒防詐', 'security')],
    [item('a', 'https://x/1', 'Same title', 'release'), item('a', 'https://x/2', 'Same title', 'release')],
  ], new Date('2026-11-21T00:00:00Z'));
  assert.deepEqual(merged.map(i => i.url).sort(), ['https://www.fsc.gov.tw/1', 'https://x/1', 'https://x/2']);
});

test('mergeNews: newest first, 60-day window, URL de-duplication and a per-source cap', () => {
  const now = new Date('2026-10-11T00:00:00Z');
  const merged = mergeNews([
    [item('a:1', '2026-10-01'), item('a:old', '2026-07-01'), item('a:dup', '2026-10-03', 'https://example.com/same')],
    [item('b:1', '2026-10-05'), item('b:dup', '2026-10-02', 'https://example.com/same')],
    Array.from({ length: 20 }, (_, i) => item(`c:${i}`, `2026-09-${String(10 + i).padStart(2, '0')}`)),
  ], now, 60, 80, 12);
  assert.deepEqual(merged.slice(0, 3).map(i => i.id), ['b:1', 'a:dup', 'a:1']);
  assert.ok(!merged.some(i => i.id === 'a:old'), 'older than 60 days');
  assert.equal(merged.filter(i => i.url === 'https://example.com/same').length, 1);
  assert.equal(merged.filter(i => i.id.startsWith('c:')).length, 12);
});

test('fetchDevNews keeps partial results and fails only when every feed fails', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const sources = [source('swift'), source('kotlin')];
    const recent = new Date().toISOString().slice(0, 10);
    const partial = await fetchDevNews(sources, async s => {
      if (s.id === 'swift') throw new Error('HTTP 503');
      return [item('kotlin:1', recent)];
    });
    assert.equal(partial.length, 1);
    await assert.rejects(fetchDevNews(sources, async () => { throw new Error('offline'); }), /dev news: every upstream failed/);
  } finally {
    console.warn = warn;
  }
});

test('Taiwan financial security: keyword picks from the FSC\'s press releases, the FSC link fix', () => {
  for (const title of [
    '永豐銀爆集體盜轉 金管會：共影響419人、轉出逾4000萬',
    '金管會：網銀盜轉獲報5件共56萬 初查非銀行遭駭',
    'Android手機變詐騙話務中繼站、泡芙箱藏上百張SIM卡！刑事局揭露詐團電話轉接新手法',
    '愛爾蘭金融業IT供應商Wellington IT遭駭，波及約40家信用合作社，會員收款人資料外洩',
    '金管會資安長會議聚焦AI攻擊與代理AI安全，籲金融業強化防禦及應變',
    '銀行提供定存解約/大額匯款通知指定聯絡人服務，協助民眾防詐',
  ]) assert.ok(TW_FIN_SECURITY.test(title), title);
  for (const title of [
    '為維護市場交易秩序，金管會宣布「全面禁止平盤以下放空」等5項措施',
    '本國銀行115年9月底辦理中小企業放款情形',
    '美媒：軟銀曾探詢1兆美元收購SK海力士　但不再考慮',
    '尼泊爾揭19家公立醫院開源電子病歷導入經驗，採6階段流程、中央統一開發與更新',
  ]) assert.ok(!TW_FIN_SECURITY.test(title), title);

  assert.ok(!NEWS_SOURCES.some(n => /cna|ithome|feedburner/i.test(n.url)), 'no news media: first-hand sources only');

  assert.equal(fscTitle({ title: ' 標題 ', link: 'https://www.fsc.gov.tw/ch/home.jsp?id=96&amp;dataserno=1&amp;dtable=News' })?.url,
    'https://www.fsc.gov.tw/ch/home.jsp?id=96&dataserno=1&dtable=News');
  const fsc = parseSourceItems(source('fsc'), [
    { title: '金管會資安長會議聚焦AI攻擊與代理AI安全，籲金融業強化防禦及應變', link: 'https://www.fsc.gov.tw/ch/home.jsp?id=96&amp;dataserno=202611130001', isoDate: '2026-11-13T00:00:00.000Z' },
    { title: '本國銀行115年9月底辦理中小企業放款情形', link: 'https://www.fsc.gov.tw/ch/home.jsp?id=96&amp;dataserno=202611170002', isoDate: '2026-11-17T00:00:00.000Z' },
  ]);
  assert.deepEqual(fsc.map(i => i.url), ['https://www.fsc.gov.tw/ch/home.jsp?id=96&dataserno=202611130001']);
});

test('TWCERT/CC TVN keeps only mobile and financial products', () => {
  const tvn = parseSourceItems(source('twcert-tvn'), [
    { title: '耀威光電｜智能路燈管理系統 - SQL Injection', link: 'https://www.twcert.org.tw/tw/cp-132-1-a-1.html', pubDate: 'Fri, 20 Nov 2026 02:36:00 GMT' },
    { title: '某銀行｜行動銀行 App - Missing Authentication', link: 'https://www.twcert.org.tw/tw/cp-132-2-b-1.html', pubDate: 'Fri, 20 Nov 2026 02:36:00 GMT' },
    { title: '某公司｜Android 版管理工具 - Hard-coded Credentials', link: 'https://www.twcert.org.tw/tw/cp-132-3-c-1.html', pubDate: 'Fri, 20 Nov 2026 02:36:00 GMT' },
    { title: '新人類資訊科技｜NT OneAPP企業雲端管理系統 - 存在5個漏洞', link: 'https://www.twcert.org.tw/tw/cp-132-4-d-1.html', pubDate: 'Thu, 22 Oct 2026 03:59:00 GMT' },
  ]);
  assert.deepEqual(tvn.map(i => [i.platform, i.important]), [['跨平台', true], ['Android', true]]);
  assert.ok(source('twcert-tvn').keep);
  assert.ok(TVN_MOBILE_FIN.test('某公司｜iOS App - XSS'));
});

test('FSC Banking Bureau: press releases by the financial-security keywords, penalties only over security or customer data', () => {
  const link = (n: number) => `https://www.banking.gov.tw/ch/home.jsp?id=550&amp;dataserno=2026110400${n}&amp;dtable=Penalty`;
  const penalties = parseSourceItems(source('banking-penalty'), [
    { title: '遠東國際商業銀行內部資訊上傳於外部網站所涉缺失，核處新臺幣200萬元罰鍰。', link: link(1), pubDate: 'Tue, 27 Oct 2026 00:00:00 GMT' },
    { title: '街口電子支付股份有限公司舊型測試主機於停用下線前遭駭客入侵致客戶個資外洩所涉缺失案，核處新臺幣120萬元罰鍰。', link: link(2), pubDate: 'Tue, 27 Oct 2026 00:00:00 GMT' },
    { title: '凱基商業銀行辦理防制洗錢及打擊資恐相關作業缺失，應予糾正。', link: link(3), pubDate: 'Tue, 27 Oct 2026 00:00:00 GMT' },
  ]);
  assert.deepEqual(penalties.map(i => i.important), [false, true], 'AML penalty left out; a hack with leaked data is important');
  assert.ok(!penalties[0].url.includes('&amp;'));
  assert.ok(!BANK_PENALTY_SECURITY.test('公布115年度系統性重要銀行名單'));
  const news = parseSourceItems(source('banking-news'), [
    { title: '銀行提供定存解約/大額匯款通知指定聯絡人服務，協助民眾防詐', link: link(4), pubDate: 'Tue, 20 Oct 2026 00:00:00 GMT' },
    { title: '115年9月底本國銀行逾期放款情形', link: link(5), pubDate: 'Tue, 20 Oct 2026 00:00:00 GMT' },
  ]);
  assert.equal(news.length, 1);
});

test('ACS (資安署) open data: JSON rows become items, Taipei dates kept as written; events left out; urgent patches important', () => {
  const rows = [
    { 來源網址: 'https://moda.gov.tw/ACS/press/news/press/21506.html', 標題: '因應NGINX發布重大安全更新    資安署籲各單位儘速升級至最新版本', 發布日期: '2026-11-21T08:16:38' },
    { 來源網址: 'https://moda.gov.tw/ACS/press/news/press/21454.html', 標題: '「2027資安星際宇宙」月曆即日起免費開放下載', 發布日期: '2026-11-17T09:10:00' },
    { 來源網址: 'https://moda.gov.tw/ACS/press/news/press/21200.html', 標題: '針對外界指稱部分網通設備受PHP漏洞影響情事 資安署呼籲各機關密切注意更新並儘速修補', 發布日期: '2026-10-29T23:55:00' },
    { 來源網址: '', 標題: '沒有連結', 發布日期: '2026-10-01T00:00:00' },
  ];
  const items = parseSourceItems(source('acs'), acsPressItems(rows));
  assert.deepEqual(items.map(i => [i.date, i.important, i.title.slice(0, 9)]), [
    ['2026-11-21', true, '因應NGINX發布'], ['2026-10-29', true, '針對外界指稱部分網'],
  ]);
  assert.equal(items[0].title, '因應NGINX發布重大安全更新 資安署籲各單位儘速升級至最新版本', 'runs of spaces collapse');
  assert.throws(() => acsPressItems({}), /not a JSON array/);
});

test('rememberNews keeps a short feed\'s items for the news window; the current copy wins', () => {
  resetHistoryState();
  const at = (date: string, url: string, title = url): DevNewsItem => ({ id: `ithome:${url}`, source: 'iThome', platform: '跨平台', category: 'security', title, url, date, important: false });
  rememberNews('ithome', [at('2026-11-03', 'a'), at('2026-09-01', 'old')], new Date('2026-11-03T12:00:00Z'));
  const kept = rememberNews('ithome', [at('2026-11-19', 'b'), at('2026-11-03', 'a', 'a (corrected)')], new Date('2026-11-21T12:00:00Z'));
  assert.deepEqual(kept.map(i => i.title), ['b', 'a (corrected)'], 'newest first; the 2026-09-01 item is past 60 days');
  assert.deepEqual(rememberNews('ithome', [], new Date('2026-11-22T12:00:00Z')).map(i => i.url), ['b', 'a'], 'a failed or empty refresh keeps what was remembered');
  assert.deepEqual(rememberNews('other', [], new Date('2026-11-22T12:00:00Z')), [], 'per feed');
  forgetOtherNews(['other']);
  assert.deepEqual(rememberNews('ithome', [], new Date('2026-11-22T12:00:00Z')), [], 'a removed feed\'s items are forgotten');
  resetHistoryState();
});

test('fetchDevNews: keep feeds add remembered items, an empty keyword pick is an answer, each feed has its own cap', async () => {
  const now = new Date('2026-11-21T12:00:00Z');
  const sources = NEWS_SOURCES.filter(s => ['swift', 'twcert-tvn', 'fsc'].includes(s.id));
  const mk = (id: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${id}:https://x/${id}/${i}`, source: id, platform: '跨平台' as const, category: 'security' as const, title: `${id} ${i}`, url: `https://x/${id}/${i}`, date: `2026-11-${String(20 - (i % 20)).padStart(2, '0')}`, important: false }));
  const remembered: string[] = [];
  const forgot: string[] = [];
  const items = await fetchDevNews(sources, async s => (s.id === 'swift' ? mk('swift', 15) : s.id === 'fsc' ? mk('fsc', 35) : []),
    (feedId, list) => { remembered.push(feedId); return feedId === 'twcert-tvn' ? mk('twcert-tvn', 2) : list; }, now, ids => forgot.push(...ids));
  assert.deepEqual(remembered, ['twcert-tvn'], 'only keep feeds are remembered');
  assert.deepEqual(forgot, ['twcert-tvn'], 'everything else remembered is dropped');
  const count = (id: string) => items.filter(i => i.id.startsWith(`${id}:`)).length;
  assert.equal(count('swift'), 12, 'the default cap');
  assert.equal(count('fsc'), 20, 'its own cap');
  assert.equal(count('twcert-tvn'), 2, 'nothing matched this time, the remembered items still show');
});
