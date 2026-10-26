import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPLE_REQUIREMENTS_URL,
  PLAY_POLICY_FALLBACK_URL,
  PLAY_POLICY_URL,
  fetchPlayPolicyDeadlines,
  parseAppleRequirements,
  parseBillingLatest,
  parsePageSizeDeadlines,
  parsePlayBilling,
  parsePlayPolicyDeadlines,
} from '../src/fetchers/requirements.js';
import { fixture, GARBAGE_HTML } from './helpers.js';
import { setRetryDelay } from '../src/net.js';

test('parseAppleRequirements: upcoming requirements with dates', () => {
  const items = parseAppleRequirements(fixture('apple-upcoming-requirements.html'));
  const target = items.find(i => /must target iOS 13/.test(i.detail));
  assert.ok(target, 'iOS 13 minimum target requirement present');
  assert.equal(target.date, '2026-09-09');
  assert.equal(target.title, 'iOS and iPadOS minimum system requirements');
  assert.equal(target.platform, 'iOS');
  assert.ok(target.url.startsWith(APPLE_REQUIREMENTS_URL));

  const sdk = items.find(i => i.title === 'SDK minimum requirements');
  assert.equal(sdk?.date, '2026-04-28');
  assert.match(sdk?.detail ?? '', /Xcode 26 or later/);
  for (const i of items) assert.match(i.date, /^\d{4}-\d{2}-\d{2}$/);
});

test('parsePlayPolicyDeadlines: policy deadline table', () => {
  const items = parsePlayPolicyDeadlines(fixture('play-policy-deadlines.html'));
  assert.ok(items.length >= 5);
  const contacts = items.find(i => /Contacts Permissions policy/.test(i.detail));
  assert.equal(contacts?.date, '2027-01-27');
  assert.equal(contacts?.title, 'Play 政策：Permissions and APIs that Access Sensitive Information（Contacts Permissions policy）', 'two changes under one policy: each named');
  const console = items.find(i => i.title === 'Play 政策：Play Console Requirements');
  assert.equal(console?.date, '2026-09-30');
  for (const i of items) {
    assert.equal(i.platform, 'Android');
    assert.doesNotMatch(i.detail, /Announced \d{4}/);
  }
});

test('parsePlayBilling: deprecation dates, extensions and the latest version from the release notes', () => {
  const { deadlines, latest } = parsePlayBilling(fixture('play-billing-deprecation.html'), fixture('billing-release-notes.html'));
  assert.equal(latest, '9.1.0');
  const pbl7 = deadlines.find(d => d.title === 'Play Billing Library 7 停止支援');
  assert.equal(pbl7?.date, '2026-08-31');
  assert.equal(pbl7?.extensionDate, '2026-11-01');
  assert.match(pbl7?.detail ?? '', /最新版本為 9\.1\.0/);
  assert.equal(deadlines.find(d => d.title.includes('Library 8'))?.date, '2027-08-31');
});

test('parsePlayBilling: missing release notes only drop `latest`', () => {
  const { deadlines, latest } = parsePlayBilling(fixture('play-billing-deprecation.html'), '');
  assert.equal(latest, undefined);
  assert.ok(deadlines.length >= 3);
  assert.doesNotMatch(deadlines[0].detail, /最新版本/);
});

test('parseBillingLatest: the highest released version in the headings, in whatever order; previews ignored', () => {
  assert.equal(parseBillingLatest(fixture('billing-release-notes.html')), '9.1.0');
  assert.equal(parseBillingLatest('<h2>Google Play Billing Library 9.1.0 Release (2026-06-18)</h2><h2>Google Play Billing Library 10.0.0 Release (2027-01-05)</h2>'), '10.0.0');
  assert.equal(parseBillingLatest(''), undefined);
  assert.equal(parseBillingLatest('<p>Google Play Billing Library 11.0.0 Release</p>'), undefined, 'only headings: a mention in the text is not a release');
});

test('parsePageSizeDeadlines: 16 KB page size deadline', () => {
  const items = parsePageSizeDeadlines(fixture('page-sizes.html'));
  assert.equal(items[0].date, '2027-02-01');
  assert.match(items[0].detail, /^Starting February 1, 2027, if your app updates don't support 16 KB/);
});

test('requirements parsers throw on an unrecognised page layout', () => {
  assert.throws(() => parseAppleRequirements(GARBAGE_HTML), /No Apple requirements/);
  assert.throws(() => parsePlayPolicyDeadlines(GARBAGE_HTML), /Play policy deadline table/);
  assert.throws(() => parsePlayBilling(GARBAGE_HTML, fixture('billing-release-notes.html')), /Play Billing deprecation table/);
  assert.throws(() => parsePageSizeDeadlines(GARBAGE_HTML), /16 KB/);
});

test('table parsers throw when the header survives but no row parses', () => {
  assert.throws(
    () => parsePlayPolicyDeadlines('<table><tr><th>Deadline</th><th>Policy change</th></tr><tr><td>Soon</td><td>TBD</td></tr></table>'),
    /parsed empty/,
  );
  assert.throws(
    () => parsePlayBilling('<table><tr><th>Version</th><th>Deadline</th><th>Extension deadline</th></tr><tr><td>7</td><td>TBD</td><td></td></tr></table>'),
    /parsed empty/,
  );
});

test('Play policy: a 429 on the primary locale tries the official en-GB page', async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  setRetryDelay(0);
  try {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      urls.push(u);
      return u === PLAY_POLICY_FALLBACK_URL
        ? new Response(fixture('play-policy-deadlines.html'))
        : new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } });
    }) as typeof fetch;
    const items = await fetchPlayPolicyDeadlines();
    assert.ok(items.length >= 5);
    assert.deepEqual(urls.filter(u => u.includes('/table/')), [PLAY_POLICY_URL, PLAY_POLICY_URL, PLAY_POLICY_FALLBACK_URL]);
  } finally {
    globalThis.fetch = original;
    setRetryDelay(1500);
  }
});

test('Play policy: if both official locales are throttled the source still reports failure', async () => {
  const original = globalThis.fetch;
  setRetryDelay(0);
  try {
    globalThis.fetch = (async () => new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } })) as typeof fetch;
    await assert.rejects(fetchPlayPolicyDeadlines(), /429/);
  } finally {
    globalThis.fetch = original;
    setRetryDelay(1500);
  }
});

test('parseAppleRequirements tolerates reordered and extra attributes, whitespace and other wrapper elements', () => {
  const html = `<article><a href="/news/upcoming-requirements/?id=1" data-x="y" class="article-title link">
      <h2 class="t">Privacy manifest requirement</h2>
    </a><div class="article-text-wrapper"><span class="article-date">Starting May 1, 2027</span>
    <div class="body article-text"><p>Apps must include a privacy manifest. More text.</p></div></div></article>`;
  const [item] = parseAppleRequirements(html);
  assert.equal(item.title, 'Privacy manifest requirement');
  assert.equal(item.date, '2027-05-01');
  assert.equal(item.detail, 'Apps must include a privacy manifest. More text.', 'the whole requirement, not only its first sentence');
  assert.ok(item.url.endsWith('?id=1'));
});

test('parsePlayTechnicalQuality: each upcoming requirement with its month (only a month is announced) and the code thresholds', async () => {
  const { parsePlayTechnicalQuality } = await import('../src/fetchers/requirements.ts');
  const items = parsePlayTechnicalQuality(fixture('play-technical-quality.html'));
  assert.deepEqual(items.map(i => [i.date, i.title]), [
    ['2027-02-01', 'Play 技術品質：記憶體用量門檻'],
    ['2027-02-01', 'Play 技術品質：程式碼混淆、最佳化與縮減門檻（R8 或其他工具）'],
    ['2027-04-01', 'Play 技術品質：零觸控登入還原（Restore Credentials）'],
  ]);
  const code = items[1];
  assert.match(code.detail, /適用：Apps with > 10 MB DEX code（遊戲：Games with > 50 MB DEX code）；門檻：Obfuscation 25%、Optimization 25%、Shrinking 25%。/);
  assert.match(code.detail, /（Google 只公布月份：2027 年 2 月起）$/, 'says the day was not announced');
  assert.equal(code.platform, 'Android');
  assert.throws(() => parsePlayTechnicalQuality('<p>nothing upcoming</p>'), /no dated upcoming requirement/);
});

test('parseAscReleaseNotes: a requirement with a date ahead, once, dated by month when only a month is given', async () => {
  const { parseAscReleaseNotes } = await import('../src/fetchers/requirements.ts');
  const note = (id: string, text: string) => `<article id="${id}"><h5 class="rn-date">October 15, 2026</h5><p>${text}</p></article>`;
  const filler = Array.from({ length: 5 }, (_, i) => note(`2026090${i}a`, 'Minor editorial fixes.')).join('');
  const html = note('20261015a', 'You can now upload apps built with Xcode 27.1. Starting April 2027, any apps or games submitted will need to include screenshots for iPhone Duo. Learn more.')
    + note('20261005a', 'Starting April 2027, any apps or games submitted will need to include screenshots for iPhone Duo.')
    + note('20260101a', 'Starting January 1, 2026, apps must do something already in the past.')
    + note('20261001a', 'Starting March 3, 2027, new apps must support the new thing.')
    + filler;
  const items = parseAscReleaseNotes(html, new Date('2026-10-26T00:00:00Z'));
  assert.deepEqual(items.map(i => [i.date, i.url.split('#')[1]]), [['2027-04-01', '20261015a'], ['2027-03-03', '20261001a']]);
  assert.equal(items[0].detail, 'Any apps or games submitted will need to include screenshots for iPhone Duo.（Apple 只公布月份：2027 年 4 月起）');
  assert.equal(items[1].detail, 'New apps must support the new thing.', 'an exact day: no note');
  assert.throws(() => parseAscReleaseNotes('<p>none</p>'), /only 0 dated notes/);
});

test('parsePlayDeveloperApiDeprecations: one item per shutdown day, with the APIs and their replacements', async () => {
  const { parsePlayDeveloperApiDeprecations } = await import('../src/fetchers/requirements.ts');
  const html = `<p>Deprecation timeline - May 21, 2025 to August 31, 2027</p><p>Overview.</p>
    <h2>Deprecation timeline - May 21, 2025 to August 31, 2027</h2>
    <table><tr><th>API</th><th>Available replacement</th></tr><tr><td>subscriptions.get</td><td>subscriptionsv2.get</td></tr><tr><td>subscriptions.revoke</td><td>subscriptionsv2.revoke</td></tr></table>
    <h2>Deprecation timeline - May 19, 2026 to August 31, 2028</h2>
    <table><tr><th>API</th><th>Available replacement</th></tr><tr><td>subscriptions.cancel</td><td></td></tr></table>`;
  const items = parsePlayDeveloperApiDeprecations(html);
  assert.deepEqual(items.map(i => i.date), ['2027-08-31', '2028-08-31']);
  assert.match(items[0].detail, /^自 2025-05-21 起已淘汰，2027-08-31 停止服務；.*受影響（2 項）：subscriptions\.get → subscriptionsv2\.get；subscriptions\.revoke → subscriptionsv2\.revoke。$/);
  assert.match(items[1].detail, /subscriptions\.cancel → （無替代）/);
  assert.throws(() => parsePlayDeveloperApiDeprecations('<p>nothing</p>'), /no deprecation timeline/);
});

test('parsePlayDeveloperApiDeprecations: the extension that can be asked for, when client libraries dropped the APIs, identifiers rejoined', async () => {
  const { parsePlayDeveloperApiDeprecations } = await import('../src/fetchers/requirements.ts');
  const html = `<h2>Deprecation timeline - May 21, 2025 to August 31, 2027</h2>
    <p>Client libraries released after June 1, 2026 no longer include these APIs. You can request an extension until Feb. 28, 2028 through Play Console Help.</p>
    <table><tr><th>API</th><th>Available replacement</th></tr><tr><td>SubscriptionPurchase. orderId</td><td>SubscriptionPurchaseV2. latestOrderId</td></tr></table>`;
  const [only] = parsePlayDeveloperApiDeprecations(html);
  assert.match(only.detail, /2026-06-01 之後發布的用戶端程式庫已不含這些 API。/);
  assert.match(only.detail, /SubscriptionPurchase\.orderId → SubscriptionPurchaseV2\.latestOrderId/);
});

test('parseAscReleaseNotes: the same requirement worded differently in two notes is kept once (the newest)', async () => {
  const { parseAscReleaseNotes } = await import('../src/fetchers/requirements.ts');
  const note = (id: string, text: string) => `<article id="${id}"><p>${text}</p></article>`;
  const filler = Array.from({ length: 5 }, (_, i) => note(`2026090${i}a`, 'Minor editorial fixes.')).join('');
  const html = note('20261015a', 'Starting April 2027, apps uploaded to App Store Connect will need to be built with the iOS 27 SDK.')
    + note('20261001a', 'Starting April 2027, apps must be built with the iOS 27 SDK or later.')
    + note('20260920a', 'Starting April 2027, any apps submitted to the App Store will need to include screenshots for iPhone Duo.')
    + filler;
  const items = parseAscReleaseNotes(html, new Date('2026-10-26T00:00:00Z'));
  assert.deepEqual(items.map(i => i.url.split('#')[1]), ['20261015a', '20260920a'], 'another requirement the same month stays');
});

test('parseDeveloperVerification: an exact regional start, and a year-only global rollout dated January 1st with a note', async () => {
  const { parseDeveloperVerification } = await import('../src/fetchers/requirements.ts');
  const html = `<h2>Where changes are in effect</h2><p>Starting September 30, 2026, these new developer verification protections go live for users in Brazil, Indonesia, Singapore, and Thailand.</p>
    <ul><li>Google (Google Play)</li><li>Samsung (Galaxy Store)</li></ul><p>Following this initial phase with our partners, we will expand these protections globally for all apps on certified Android devices in 2027.</p>`;
  const [regional, global] = parseDeveloperVerification(html);
  assert.deepEqual([regional.date, regional.title], ['2026-09-30', 'Android 開發者驗證：Brazil、Indonesia、Singapore、Thailand 開始實施']);
  assert.deepEqual([global.date, global.title], ['2027-01-01', 'Android 開發者驗證：擴大到全球所有認證 Android 裝置']);
  assert.match(global.detail, /^Following this initial phase.*in 2027\.（Google 只公布年份：2027 年，最早可能在年初）$/);
  assert.throws(() => parseDeveloperVerification('<p>nothing dated</p>'), /no dated rollout/);
});

test('parseDeveloperVerification: a long page without full stops reads fast, and a long clause keeps its year-only note', async () => {
  const { parseDeveloperVerification } = await import('../src/fetchers/requirements.ts');
  const started = Date.now();
  assert.throws(() => parseDeveloperVerification(`<p>globally ${'word '.repeat(10000)}</p>`), /no dated rollout/);
  assert.throws(() => parseDeveloperVerification(`<p>${'globally in a list '.repeat(3000)}</p>`), /no dated rollout/);
  assert.ok(Date.now() - started < 500, 'no backtracking over the whole page');
  const [global] = parseDeveloperVerification(`<p>We will expand these protections globally ${'for many more apps and stores '.repeat(20)}in 2027.</p>`);
  assert.match(global.detail, /…（Google 只公布年份：2027 年，最早可能在年初）$/, 'shortened before the note, not through it');
});

test('parseAscReleaseNotes: a month-only requirement stays listed through that month, an exact one through its day', async () => {
  const { parseAscReleaseNotes } = await import('../src/fetchers/requirements.ts');
  const note = (id: string, text: string) => `<article id="${id}"><p>${text}</p></article>`;
  const html = note('20261015a', 'Starting April 2027, any apps or games submitted will need to include screenshots for iPhone Duo.')
    + note('20261014a', 'Starting April 20, 2027, new apps must support the new thing.')
    + Array.from({ length: 5 }, (_, i) => note(`2026090${i}a`, 'Minor editorial fixes.')).join('');
  const on = (day: string) => parseAscReleaseNotes(html, new Date(`${day}T04:00:00Z`)).map(i => i.date);
  assert.deepEqual(on('2027-04-01'), ['2027-04-01', '2027-04-20']);
  assert.deepEqual(on('2027-04-20'), ['2027-04-01', '2027-04-20']);
  assert.deepEqual(on('2027-04-21'), ['2027-04-01']);
  assert.deepEqual(on('2027-05-01'), []);
});

test('parseAppleNewsRequirements: dated requirements in news posts, one item per post and day, ahead only', async () => {
  const { parseAppleNewsRequirements } = await import('../src/fetchers/requirements.ts');
  const posts = [
    { title: 'Upcoming expiration of Developer ID Certification Authority (Sub-CA)', link: 'https://developer.apple.com/news/?id=w4atic4c', pubDate: 'Thu, 01 Oct 2026 10:00:11 PDT',
      contentSnippet: 'The original Developer ID Certification Authority (Sub-CA) expires on February 1, 2027. Certificates issued by this authority will stop working on that date.\nInstaller packages (.pkg): Starting February 1, 2027, .pkg files signed with an affected certificate will no longer install.' },
    { title: 'App Store submissions now open', link: 'https://developer.apple.com/news/?id=x', pubDate: 'Wed, 09 Sep 2026 16:00:38 PDT',
      contentSnippet: 'Starting April 2027, apps and games uploaded to App Store Connect need to meet the following minimum requirements:' },
    { title: 'Prepare for iPhone Duo', link: 'https://developer.apple.com/news/?id=y', pubDate: 'Mon, 05 Oct 2026 17:05:33 PDT',
      contentSnippet: 'Starting April 2027, any apps or games submitted will need to include screenshots for iPhone Duo.' },
    { title: 'Old', link: 'https://developer.apple.com/news/?id=z', pubDate: 'Thu, 09 Oct 2025 05:00:09 PDT',
      contentSnippet: 'Starting January 1, 2026, developers must provide an endpoint.' },
  ];
  const items = parseAppleNewsRequirements(posts, new Date('2026-10-26T04:00:00Z'));
  assert.deepEqual(items.map(i => [i.date, i.url]), [['2027-02-01', 'https://developer.apple.com/news/?id=w4atic4c'], ['2027-04-01', 'https://developer.apple.com/news/?id=y']], 'the SDK minimum is the App Store deadline\'s; past dates go');
  assert.match(items[0].detail, /^The original Developer ID .*expires on February 1, 2027\. Installer packages .*will no longer install\.（2026-10-01 公告）$/);
  assert.match(items[1].detail, /（Apple 只公布月份：2027 年 4 月起）（2026-10-05 公告）$/);
});

test('mergeAppleRequirements: one requirement on several pages kept once; a word every news title shares is no match', async () => {
  const { mergeAppleRequirements } = await import('../src/fetchers/requirements.ts');
  const d = (date: string, title: string, detail: string) => ({ platform: 'iOS' as const, date, title, detail, source: 'S', url: 'https://developer.apple.com/' });
  const upcoming = [d('2027-02-28', 'Apple Developer Program requirement', 'Apple Developer Program members must accept the updated agreement.')];
  const notes = [d('2027-04-01', 'App Store Connect：Any apps will need screenshots for iPhone Duo', 'Any apps or games submitted will need to include screenshots for iPhone Duo.（Apple 只公布月份：2027 年 4 月起）')];
  const news = [
    d('2027-02-01', 'Apple Developer News：macOS：Upcoming expiration of Developer ID Certification Authority', 'The Sub-CA expires on February 1, 2027.'),
    d('2027-04-01', 'Apple Developer News：Prepare and submit your apps for iPhone Duo', 'Starting April 2027, any apps or games submitted will need to include screenshots for iPhone Duo.'),
  ];
  assert.deepEqual(mergeAppleRequirements(upcoming, notes, news).map(r => r.title), [
    'Apple Developer Program requirement',
    'App Store Connect：Any apps will need screenshots for iPhone Duo',
    'Apple Developer News：macOS：Upcoming expiration of Developer ID Certification Authority',
  ]);
});
