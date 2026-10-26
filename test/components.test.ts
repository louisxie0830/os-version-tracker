import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { APP_PARTS, readPart, readScript } from '../src/asset-versions.ts';
import { build, chips, click, connectAll, FakeElement, FakeEvent, fakeFocus, key, loadComponents, state, type Spec } from './fake-dom.ts';
import { COMPONENT_TAGS } from '../src/component-tags.ts';
import type { AllVersions } from '../src/fetch-all.ts';
import { renderHTML } from '../src/render.ts';
import { renderBanksSection } from '../src/render-banks.ts';
import { renderNewsSection } from '../src/render-docs.ts';
import { renderTrendsSection } from '../src/render-trends.ts';

/**
 * The custom elements around the server-rendered markup (src/browser/*.ts, compiled to dist/browser/):
 * the markup they wrap, and the compiled scripts'
 * behaviour against a small fake of the DOM they use.
 * The page check (scripts/page-probe.js) exercises the same behaviour in a real browser.
 */

const snapshot = JSON.parse(readFileSync(new URL('./fixtures/all-versions.json', import.meta.url), 'utf8')) as AllVersions;
const TAGS: readonly string[] = COMPONENT_TAGS;

/** Every custom element opened is closed, and none is nested in another of the same name */
function assertBalanced(html: string) {
  for (const tag of TAGS) {
    let depth = 0;
    for (const m of html.matchAll(new RegExp(`<(/?)${tag}\\b`, 'g'))) {
      depth += m[1] ? -1 : 1;
      assert.ok(depth === 0 || depth === 1, `${tag} nested or closed before it opened`);
    }
    assert.equal(depth, 0, `${tag} left open`);
  }
}

// ---------- markup ----------

test('home page: the feed rail and bank filters are wrapped in choice-chips named after their group, the full markup kept inside', () => {
  const html = renderHTML(snapshot);
  assertBalanced(html);
  assert.doesNotMatch(html, /attachShadow|shadowroot/i, 'Light DOM only');
  for (const group of ['type', 'platform']) {
    assert.match(html, new RegExp(`<choice-chips name="${group}"><div class="chips" role="radiogroup" aria-label="篩選[^"]+" data-filter-group="${group}">\\s*<button type="button" class="chip is-active" role="radio" data-value="all" aria-checked="true" tabindex="0">全部</button><button type="button" class="chip" role="radio" data-value="[^"]+" aria-checked="false" tabindex="-1">`));
  }
  const bankGroups = [...html.matchAll(/data-bank-filter="(\w+)"/g)].map(m => m[1]);
  assert.ok(bankGroups.length >= 2, 'the fixture has bank filters');
  for (const group of bankGroups) assert.match(html, new RegExp(`<choice-chips name="${group}"><div class="chips" role="radiogroup" aria-label="[^"]+" data-bank-filter="${group}">`));
  // Every radio group on the page is a choice-chips, and every chip a radio
  const groups = html.match(/role="radiogroup"/g) ?? [];
  assert.equal(groups.length, (html.match(/<choice-chips name="[^"]+"><div class="[^"]+" role="radiogroup"/g) ?? []).length);
  assert.equal((html.match(/class="chip[ "]/g) ?? []).length, (html.match(/class="chip(?: is-active)?" role="radio"/g) ?? []).length);
  assert.doesNotMatch(html, /aria-pressed="(true|false)" ?(?!aria-label)[^>]*class="chip/);
});

test('activity: one component contains the search input, filter rail, now cards and feed controls', () => {
  const html = renderHTML(snapshot);
  const inner = html.match(/<activity-filter filters="type platform">([\s\S]*?)<\/activity-filter>/)?.[1] ?? '';
  assert.match(inner, /<input type="search" id="search" data-activity-search data-page-search/);
  assert.match(inner, /<choice-chips name="type">/);
  assert.match(inner, /<choice-chips name="platform">/);
  assert.match(inner, /id="now" data-feed-now/);
  assert.match(inner, /id="now-empty" data-now-empty hidden/);
  assert.match(inner, /id="feed-empty" data-feed-empty/);
  assert.match(inner, /<p class="sr-only" role="status" data-filter-status><\/p>/);
  assert.equal(html.match(/<activity-filter\b/g)?.length, 1);
  // The feed's cap: rows past the first 15 are marked, the list starts collapsed and the button can lift it
  const feed = inner.match(/<ul class="feed-list[^"]*"[^>]*>[\s\S]*?<\/ul>/)?.[0] ?? '';
  const rows = feed.match(/<li /g)?.length ?? 0;
  assert.ok(rows > 15, 'the fixture has more rows than the cap');
  assert.match(feed, /^<ul class="feed-list is-collapsed" data-capped>/);
  assert.equal(feed.match(/class="feed-row list-extra"/g)?.length, rows - 15);
  assert.doesNotMatch(feed, /<li [^>]*\bhidden\b/, 'no row hidden by the markup: without script every row shows');
  assert.match(inner, /id="feed-more" data-show-more>/);
});

test('search: one page-search around the activity filter holds the input, the status line and every section', () => {
  const html = renderHTML(snapshot);
  assertBalanced(html);
  assert.equal(html.match(/<page-search\b/g)?.length, 1);
  const inner = html.match(/<page-search skip="now feed" jump-to="now">([\s\S]*?)<\/page-search>/)?.[1] ?? '';
  assert.match(inner, /^\s*<activity-filter filters="type platform">[\s\S]*<\/activity-filter>\s*$/, 'wraps exactly the activity filter');
  assert.match(inner, /<input [^>]*data-page-search/);
  assert.match(inner, /data-search-status hidden><span data-search-summary><\/span><button [^>]*data-search-clear>/);
  for (const id of ['now', 'feed', 'banks', 'legal']) assert.match(inner, new RegExp(`<section [^>]*id="${id}"`), id);
  // The section list is a section-nav whose links all point into the page
  const nav = html.match(/<section-nav><nav class="section-nav"[^>]*>([\s\S]*?)<\/nav><\/section-nav>/)?.[1] ?? '';
  assert.deepEqual([...nav.matchAll(/href="#([\w-]+)"/g)].map(m => m[1]).slice(0, 2), ['now', 'feed']);
});

test('news: one news-list owns declarative choice chips, rows, show-more and an existing empty state', () => {
  const item = (platform: 'iOS' | 'Android' | '跨平台', important: boolean, i: number) => ({
    id: `item-${i}`, source: 'Official', platform, category: 'release' as const, title: `Release ${i}`,
    url: `https://example.com/${i}`, date: '2026-10-25', important,
  });
  const html = renderNewsSection({
    ...snapshot,
    devNews: Array.from({ length: 26 }, (_, i) => item(i % 2 ? 'Android' : 'iOS', i === 0, i)),
  });
  assertBalanced(html);
  const inner = html.match(/<news-list filters="news">([\s\S]*?)<\/news-list>/)?.[1] ?? '';
  assert.match(inner, /<choice-chips name="news"><div class="news-filters"/);
  assert.match(inner, /<choice-chips name="news"><div class="news-filters" role="radiogroup" aria-label="篩選新聞">/);
  assert.match(inner, /data-value="all" aria-checked="true" tabindex="0"/);
  assert.match(inner, /<ul class="news news-feed is-collapsed" data-capped id="news-list" data-news-items data-search-rows>/);
  assert.match(inner, /id="news-show-more" data-show-more>/);
  assert.match(inner, /data-news-empty hidden>沒有符合的新聞/);
  assert.match(inner, /<p class="sr-only" role="status" data-filter-status><\/p>/);
  // Each row's data-news holds every value of the filter that lets it through; one row past the cap
  assert.match(inner, /<li class="news-item" data-news="iOS\|important"/);
  assert.match(inner, /<li class="news-item" data-news="Android"/);
  assert.equal(inner.match(/class="news-item list-extra"/g)?.length, 1);
  // Every chip value matches some row token (or is "all")
  const tokens = new Set([...inner.matchAll(/data-news="([^"]+)"/g)].flatMap(m => m[1].split('|')));
  for (const [, value] of inner.matchAll(/class="chip[^"]*" data-value="([^"]+)"/g)) {
    if (value !== 'all' && value !== '跨平台') assert.ok(tokens.has(value), value);
  }
  const few = renderNewsSection({ ...snapshot, devNews: [item('iOS', false, 0)] });
  assert.match(few, /<ul class="news news-feed" id="news-list" data-news-items data-search-rows>/, 'no cap to lift: no is-collapsed');
  assert.doesNotMatch(few, /data-show-more/);
});

test('banks: one bank-table wraps the filters, the sort, the count, the table and the empty message', () => {
  const html = renderHTML(snapshot);
  const inner = html.match(/<bank-table filters="([\w ]+)">([\s\S]*?)<\/bank-table>/)?.[2] ?? '';
  const filters = html.match(/<bank-table filters="([\w ]+)">/)?.[1].split(' ') ?? [];
  // Every filter group on the page is one the table listens to, and every row carries its value
  for (const [, group] of inner.matchAll(/data-bank-filter="(\w+)"/g)) {
    assert.ok(filters.includes(group), `${group}: listed in filters`);
    assert.match(inner.match(/<tr[^>]* data-index="0"[^>]*>/)?.[0] ?? '', new RegExp(` data-${group}="`), `${group}: on every row`);
  }
  for (const hook of ['class="bank-filters"', '<select id="bank-sort" data-bank-sort>', 'id="bank-count" data-bank-count', 'id="bank-rows" data-search-rows', 'id="bank-empty" data-bank-empty hidden']) {
    assert.ok(inner.includes(hook), hook);
  }
  assert.equal(html.match(/<bank-table\b/g)?.length, 1);
  // The sort options declare the row dataset key and direction they order by; bank-table.js knows no names
  const options = [...inner.matchAll(/<option value="(\w+)"( data-sort-key="(\w+)" data-sort-dir="(asc|desc)")?>/g)];
  assert.deepEqual(options.map(m => [m[1], m[3], m[4]]), [
    ['default', undefined, undefined],
    ['ios', 'iosSort', 'desc'],
    ['android', 'androidSort', 'desc'],
    ['target', 'targetSort', 'asc'],
  ], 'first option keeps the page order; the rest in a fixed order');
  const rowAttrs = inner.match(/<tr[^>]* data-index="0"[^>]*>/)?.[0] ?? '';
  for (const [, , , key] of options.filter(m => m[3])) {
    assert.match(rowAttrs, new RegExp(` data-${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}="-?[\\d.]+"`), `${key}: every row carries it`);
  }
  for (const source of [readPart('bank-table.js').toString(), readFileSync(new URL('../src/browser/bank-table.ts', import.meta.url), 'utf8')]) {
    assert.doesNotMatch(source, /iosSort|androidSort|targetSort|'ios'|'android'|'target'/, 'the controller is generic');
  }
  // Inside the section, so the whole-page search still walks it as part of #banks
  assert.match(html, /<section class="panel" id="banks">[\s\S]*<bank-table [\s\S]*<\/bank-table>[\s\S]*?<\/section>/);
  assert.equal(renderBanksSection({ ...snapshot, twBanks: [] }), '', 'no banks, no wrapper');
});

test('trends: each card is a chart-switch holding its toggle and the charts it switches; each chart a line-chart', () => {
  const months = ['2026-08', '2026-09'];
  const trend = { months, series: [{ version: '26', shares: [80, 75] }, { version: '18', shares: [20, 25] }], url: 'https://gs.statcounter.com/' };
  const html = renderTrendsSection({
    ...snapshot,
    osShare: { trend: { ios: { TW: trend, ww: trend } }, vendor: { TW: trend } } as never,
    bankTrend: [{ date: '2026-10-15', iOS: { '15': 1 }, Android: { '9': 1 } }, { date: '2026-10-16', iOS: { '15': 1 }, Android: { '9': 1 } }],
  });
  assertBalanced(html);
  const cards = [...html.matchAll(/<chart-switch>([\s\S]*?)<\/chart-switch>/g)].map(m => m[1]);
  assert.equal(cards.length, 3, 'iOS share, vendor and bank trend cards');
  assert.equal((html.match(/<div class="case trend-card">/g) ?? []).length, cards.length, 'every card wrapped');
  for (const card of cards) {
    for (const [, group] of card.matchAll(/data-chart-toggle="([^"]+)"/g)) {
      assert.match(card, new RegExp(`<choice-chips name="${group}"><div class="chips chart-toggle"`), `${group}: the toggle is a choice-chips of that name`);
      assert.ok(card.includes(`data-chart-group="${group}"`), `${group}: what it switches is in the same card`);
    }
  }
  const figures = html.match(/<figure class="chart"/g)?.length ?? 0;
  assert.ok(figures >= 4);
  assert.equal((html.match(/<line-chart><figure class="chart"[^>]*data-chart="/g) ?? []).length, figures, 'every chart wrapped, its data kept');
});

test('the wrappers take no box of their own, so the grid and flex layouts around them are unchanged', async () => {
  const { PAGE_CSS } = await import('../src/render-styles.ts');
  assert.match(PAGE_CSS, new RegExp(`${TAGS.join(', ')} \\{ display: contents; \\}`));
});

// ---------- source and output ----------

test('app.js is written in TypeScript only: its parts are src/browser/*.ts compiled to classic scripts and joined in order', () => {
  const app = readScript('app.js').toString();
  let at = -1;
  for (const name of APP_PARTS) {
    const source = new URL(`../src/browser/${name.replace(/\.js$/, '.ts')}`, import.meta.url);
    assert.ok(existsSync(source), `${name}: its TypeScript source`);
    assert.ok(!existsSync(new URL(`../public/${name}`, import.meta.url)), `${name}: no hand-kept copy in public/`);
    const js = readPart(name).toString();
    // Joined into one classic script, not a module: an import, export or CommonJS export would break it
    assert.doesNotMatch(js, /^\s*(import|export)\b|\bexports\b|\brequire\(/m, `${name}: a classic script`);
    const next = app.indexOf(js, at + 1);
    assert.ok(next > at, `${name}: in app.js, after the parts before it`);
    at = next;
  }
  // The base is first and the one place that registers; every component it registers is in COMPONENT_TAGS
  assert.equal(APP_PARTS[0], 'light-element.js');
  assert.match(readPart('light-element.js').toString(), /^function defineElement\(/m);
  assert.ok(APP_PARTS.indexOf('choice-chips.js') < APP_PARTS.indexOf('activity-filter.js'), 'chips before the controllers that restore through them');
  assert.equal(APP_PARTS.at(-1), 'page.js', 'page behaviour last');
  const defined = APP_PARTS.flatMap(name => [...readPart(name).toString().matchAll(/\bdefineElement\('([a-z]+-[a-z-]+)'/g)].map(m => m[1]));
  assert.deepEqual([...defined].sort(), [...COMPONENT_TAGS].sort());
  assert.equal(app.match(/customElements\.define\(/g)?.length, 1, 'only defineElement registers');
});

// ---------- behaviour, against a small fake DOM (fake-dom.ts) ----------

test('choice-chips: a click keeps is-active, aria-checked and the tab stop in step and sends one bubbling choice-change', () => {
  const registry = loadComponents();
  const root = build(registry, ['div', {}, [chips('platform', ['all', 'iOS', 'Android'])]]);
  connectAll(root);
  connectAll(root); // connected again (moved in the page): still one listener
  const group = root.querySelector('choice-chips')!;
  const seen: unknown[] = [];
  root.addEventListener('choice-change', e => seen.push(e.detail));
  click(group.querySelectorAll('.chip')[2]);
  assert.deepEqual(state(group), ['all:false:false:-1', 'iOS:false:false:-1', 'Android:true:true:0']);
  assert.deepEqual(seen, [{ name: 'platform', value: 'Android' }], 'bubbled to the parent, once');
  click(group.querySelector('.chips')!);
  assert.equal(seen.length, 1, 'a click between chips changes nothing');
});

test('activity-filter: combines type, platform and search; a filter lifts the cap and "more" lifts it for good', () => {
  const registry = loadComponents();
  const activity = build(registry, ['activity-filter', { filters: 'type platform' }, [
    ['input', { 'data-activity-search': '', value: '' }],
    chips('type', ['all', 'security']),
    chips('platform', ['all', 'iOS']),
    ['section', { 'data-feed-now': '' }, [
      ['article', { 'data-feed-item': '', 'data-type': 'security', 'data-platform': 'iOS' }],
      ['article', { 'data-feed-item': '', 'data-type': 'news', 'data-platform': 'Android' }],
      ['p', { 'data-now-empty': '', hidden: '' }],
    ]],
    ['section', { id: 'feed' }, [
      ['span', { 'data-feed-count': '' }],
      ['ul', { class: 'is-collapsed', 'data-capped': '' }, [
        ['li', { 'data-feed-item': '', 'data-type': 'security', 'data-platform': 'Android' }],
        ['li', { class: 'list-extra', 'data-feed-item': '', 'data-type': 'deadline', 'data-platform': 'iOS' }],
      ]],
      ['p', { 'data-feed-empty': '', hidden: '' }],
      ['p', { 'data-filter-status': '' }],
      ['button', { 'data-show-more': '' }],
    ]],
  ]]);
  const items = activity.querySelectorAll('[data-feed-item]');
  ['iOS security fix', 'Android announcement', 'Android security alert', 'iOS deadline'].forEach((text, i) => { items[i].textContent = text; });
  const reports: unknown[] = [];
  activity.addEventListener('activity-filtered', e => reports.push(e.detail));
  connectAll(activity);
  connectAll(activity);
  const list = activity.querySelector('[data-capped]')!;
  const more = activity.querySelector('[data-show-more]')!;
  const nowEmpty = activity.querySelector('[data-now-empty]')!;
  const feedEmpty = activity.querySelector('[data-feed-empty]')!;
  const status = activity.querySelector('[data-filter-status]')!;
  const count = activity.querySelector('[data-feed-count]')!;
  assert.deepEqual(items.map(item => item.hidden), [false, false, false, false], 'rows are hidden by filters only; the cap is the stylesheet\'s');
  assert.equal(list.classList.contains('is-collapsed'), true);
  assert.equal(more.hidden, false);
  assert.deepEqual(reports, [{ shown: 3 }], 'set up once, and reports its matches (not the row still behind "show more")');
  assert.equal(status.textContent, '', 'nothing announced before a choice');

  click(activity.querySelectorAll('choice-chips')[0].querySelectorAll('.chip')[1]);
  assert.deepEqual(items.map(item => item.hidden), [false, true, false, true]);
  assert.equal(list.classList.contains('is-collapsed'), false, 'a filter shows every match');
  assert.equal(more.hidden, true);
  assert.equal(status.textContent, '待處理 1 項、最新動態 1 項');
  assert.equal(count.textContent, '符合條件 1 項', 'the feed header counts what is listed while filtered');
  click(activity.querySelectorAll('choice-chips')[1].querySelectorAll('.chip')[1]);
  assert.deepEqual(items.map(item => item.hidden), [false, true, true, true]);
  assert.equal(nowEmpty.hidden, true);
  assert.equal(feedEmpty.hidden, false, 'no feed match: its empty state shows');
  assert.equal(registry.page.location.search, '?f-type=security&f-platform=iOS', 'the choices are kept in the address');

  click(activity.querySelectorAll('choice-chips')[0].querySelectorAll('.chip')[0]);
  click(activity.querySelectorAll('choice-chips')[1].querySelectorAll('.chip')[0]);
  assert.equal(registry.page.location.search, '', '"all" leaves the address');
  assert.equal(list.classList.contains('is-collapsed'), true, 'no filter: capped again');
  assert.equal(count.textContent, '', 'no filter: back to its own text');
  const search = activity.querySelector('[data-activity-search]')!;
  search.value = 'Security Alert';
  search.dispatchEvent(new FakeEvent('input'));
  assert.deepEqual(items.map(item => item.hidden), [false, false, false, false], 'typing settles before anything changes');
  registry.page.advance(120);
  assert.deepEqual(items.map(item => item.hidden), [true, true, false, true], 'search ignores case');
  assert.equal(nowEmpty.hidden, false);
  assert.equal(feedEmpty.hidden, true);
  assert.deepEqual(reports.at(-1), { shown: 1 });

  search.value = '';
  search.dispatchEvent(new FakeEvent('input'));
  registry.page.advance(120);
  click(more);
  assert.equal(more.dataset.expanded, '1');
  assert.equal(more.hidden, true);
  assert.equal(list.classList.contains('is-collapsed'), false, 'expanded for good');
  assert.deepEqual(items.map(item => item.hidden), [false, false, false, false]);
});

test('filters: choices in the address are restored on setup, unknown ones ignored, and nothing is announced', () => {
  const registry = loadComponents('https://example.com/?f-type=security&f-platform=nope&type=news#feed');
  const activity = build(registry, ['activity-filter', { filters: 'type platform' }, [
    chips('type', ['all', 'security']),
    chips('platform', ['all', 'iOS']),
    ['ul', {}, [
      ['li', { 'data-feed-item': '', 'data-type': 'security', 'data-platform': 'iOS' }],
      ['li', { 'data-feed-item': '', 'data-type': 'news', 'data-platform': 'iOS' }],
    ]],
    ['p', { 'data-filter-status': '' }],
  ]]);
  connectAll(activity);
  const [type, platform] = activity.querySelectorAll('choice-chips');
  assert.deepEqual(state(type), ['all:false:false:-1', 'security:true:true:0'], 'the chip shows the restored choice');
  assert.deepEqual(state(platform), ['all:true:true:0', 'iOS:false:false:-1'], 'an unknown value keeps the default');
  assert.deepEqual(activity.querySelectorAll('[data-feed-item]').map(item => item.hidden), [false, true]);
  assert.equal(activity.querySelector('[data-filter-status]')!.textContent, '');
  assert.equal(registry.page.location.href, 'https://example.com/?f-type=security&f-platform=nope&type=news#feed', 'the address is left as it was (and an unprefixed type= ignored)');
});

test('filters: a group the filters attribute doesn\'t name is left alone', () => {
  const registry = loadComponents();
  const news = build(registry, ['news-list', { filters: 'news' }, [
    chips('news', ['all', 'iOS']),
    chips('other', ['all', 'iOS']),
    ['ul', { 'data-news-items': '' }, [['li', { 'data-news': 'iOS' }], ['li', { 'data-news': 'Android' }]]],
  ]]);
  connectAll(news);
  click(news.querySelectorAll('choice-chips')[1].querySelectorAll('.chip')[1]);
  assert.deepEqual(news.querySelectorAll('li').map(row => row.hidden), [false, false]);
  assert.equal(registry.page.location.search, '');
});

test('components: disconnecting drops their listeners; connecting again sets them up afresh', () => {
  const registry = loadComponents();
  const root = build(registry, ['div', {}, [chips('platform', ['all', 'iOS'])]]);
  connectAll(root);
  const group = root.querySelector('choice-chips')! as FakeElement & { disconnectedCallback(): void };
  const seen: unknown[] = [];
  root.addEventListener('choice-change', e => seen.push(e.detail));
  group.disconnectedCallback();
  click(group.querySelectorAll('.chip')[1]);
  assert.equal(seen.length, 0, 'no listener while disconnected');
  connectAll(root);
  click(group.querySelectorAll('.chip')[1]);
  assert.equal(seen.length, 1, 'one listener again');
});

test('bank-table: chips filter the rows, the count and empty message follow, and the sort reorders by data value', () => {
  const registry = loadComponents();
  const row = (i: number, ios: string, iosSort: string, rank: string): Spec => ['tr', { 'data-index': String(i), 'data-ios': ios, 'data-ios-sort': iosSort, 'data-rank': rank }];
  const table = build(registry, ['bank-table', { filters: 'ios' }, [
    chips('ios', ['all', '15', '17']),
    ['select', { 'data-bank-sort': '', value: 'default' }, [
      ['option', { value: 'default' }],
      ['option', { value: 'high', 'data-sort-key': 'iosSort', 'data-sort-dir': 'desc' }],
      // Any name, any row key: the component only follows what the option declares
      ['option', { value: 'low', 'data-sort-key': 'rank', 'data-sort-dir': 'asc' }],
      ['option', { value: 'rank-high', 'data-sort-key': 'rank', 'data-sort-dir': 'desc' }],
    ]],
    ['span', { 'data-bank-count': '' }],
    ['tbody', {}, [row(0, '15', '15.04', '2'), row(1, '17', '17', '3'), row(2, '15', '15', '2')]],
    ['p', { 'data-bank-empty': '', hidden: '' }],
  ]]);
  connectAll(table);
  connectAll(table);
  const body = table.querySelector('tbody')!;
  const count = table.querySelector('[data-bank-count]')!;
  const empty = table.querySelector('[data-bank-empty]')!;
  const [all, v15, v17] = table.querySelectorAll('.chip');
  click(v15);
  assert.deepEqual(body.rows.map(r => r.hidden), [false, true, false]);
  assert.equal(count.textContent, '顯示 2 / 3 個 App');
  assert.equal(empty.hidden, true);
  click(v17);
  assert.equal(count.textContent, '顯示 1 / 3 個 App');
  v17.dataset.value = '99';
  click(v17);
  assert.equal(count.textContent, '顯示 0 / 3 個 App');
  assert.equal(empty.hidden, false, 'nothing left: the empty message shows');
  click(all);
  assert.equal(count.textContent, '共 3 個 App');
  const sort = table.querySelector('select')!;
  const order = (value: string) => {
    sort.value = value;
    sort.dispatchEvent(new FakeEvent('change'));
    return body.rows.map(r => r.dataset.index);
  };
  assert.deepEqual(order('high'), ['1', '0', '2'], 'descending: highest first');
  assert.deepEqual(order('low'), ['0', '2', '1'], 'ascending: lowest first, ties by page order');
  assert.deepEqual(order('rank-high'), ['1', '0', '2'], 'the same key descending, ties still by page order');
  assert.deepEqual(order('low'), ['0', '2', '1'], 'the same result again, whatever came before');
  assert.deepEqual(order('default'), ['0', '1', '2'], 'an option without a key: the page order');
  assert.deepEqual(order('missing'), ['0', '1', '2'], 'a value with no option: the page order');
  click(v15);
  assert.deepEqual(order('low'), ['0', '2', '1'], 'hidden rows are ordered too');
  assert.deepEqual(body.rows.map(r => r.hidden), [false, false, true]);
  click(all);
  sort.value = 'default';
  sort.dispatchEvent(new FakeEvent('change'));
  assert.deepEqual(body.rows.map(r => r.dataset.index), ['0', '1', '2'], 'back to the page order');
});

test('bank-table: a sort the browser kept is applied on setup, and filtering leaves the order alone', () => {
  const registry = loadComponents('https://example.com/?f-ios=15');
  const row = (i: number, ios: string, iosSort: string): Spec => ['tr', { 'data-index': String(i), 'data-ios': ios, 'data-ios-sort': iosSort }];
  const table = build(registry, ['bank-table', { filters: 'ios' }, [
    chips('ios', ['all', '15', '17']),
    // Coming back to the page, the select shows the sort chosen before
    ['select', { 'data-bank-sort': '', value: 'high' }, [
      ['option', { value: 'default' }],
      ['option', { value: 'high', 'data-sort-key': 'iosSort', 'data-sort-dir': 'desc' }],
    ]],
    ['span', { 'data-bank-count': '' }],
    ['tbody', {}, [row(0, '15', '15'), row(1, '17', '17'), row(2, '16', '16')]],
  ]]);
  connectAll(table);
  const body = table.querySelector('tbody')!;
  assert.deepEqual(body.rows.map(r => r.dataset.index), ['1', '2', '0'], 'ordered as the select says');
  assert.deepEqual(body.rows.map(r => r.hidden), [true, true, false], 'the filter in the address applied');
  assert.equal(table.querySelector('[data-bank-count]')!.textContent, '顯示 1 / 3 個 App');
  // Rows put in another order behind its back stay there: a filter change doesn't sort
  body.append(body.rows[0]);
  click(table.querySelectorAll('.chip')[0]);
  assert.deepEqual(body.rows.map(r => r.dataset.index), ['2', '0', '1']);
  assert.equal(table.querySelector('[data-bank-count]')!.textContent, '共 3 個 App');
});

test('bank-table: optional parts may be missing; without a table it does nothing and stays ready to retry', () => {
  const registry = loadComponents();
  const bare = build(registry, ['bank-table', { filters: 'kind' }, [chips('kind', ['all', 'other']), ['tbody', {}, [['tr', { 'data-index': '0', 'data-kind': 'personal' }]]]]]);
  connectAll(bare);
  click(bare.querySelectorAll('.chip')[1]);
  assert.equal(bare.querySelector('tbody')!.rows[0].hidden, true, 'filters without count, empty message or sort');
  const none = build(registry, ['bank-table', { filters: 'kind' }, [chips('kind', ['all', 'other'])]]);
  assert.doesNotThrow(() => { connectAll(none); click(none.querySelectorAll('.chip')[1]); });
});

test('news-list: filters rows by their data-news values, exposes a stable empty state and expands the unfiltered list', () => {
  const registry = loadComponents();
  const news = build(registry, ['news-list', { filters: 'news' }, [
    chips('news', ['all', 'Android', 'important', 'missing']),
    ['ul', { class: 'is-collapsed', 'data-capped': '', 'data-news-items': '' }, [
      ['li', { 'data-news': 'iOS|important' }],
      ['li', { 'data-news': 'Android' }],
      ['li', { class: 'list-extra', 'data-news': '跨平台' }],
    ]],
    ['button', { 'data-show-more': '' }],
    ['div', { 'data-news-empty': '', hidden: '' }],
    ['p', { 'data-filter-status': '' }],
  ]]);
  connectAll(news);
  connectAll(news);
  const list = news.querySelector('[data-news-items]')!;
  const more = news.querySelector('[data-show-more]')!;
  const empty = news.querySelector('[data-news-empty]')!;
  const status = news.querySelector('[data-filter-status]')!;
  const [, android, important, missing] = news.querySelectorAll('.chip');
  assert.equal(list.classList.contains('is-collapsed'), true);
  assert.equal(more.hidden, false);
  assert.equal(empty.hidden, true);

  click(android);
  assert.deepEqual(list.children.map(row => row.hidden), [true, false, true]);
  assert.equal(list.classList.contains('is-collapsed'), false, 'a filter shows every match');
  assert.equal(more.hidden, true);
  assert.equal(status.textContent, '顯示 1 則新聞');
  click(important);
  assert.deepEqual(list.children.map(row => row.hidden), [false, true, true], 'one of several values matches');
  assert.equal(registry.page.location.search, '?f-news=important');
  click(missing);
  assert.deepEqual(list.children.map(row => row.hidden), [true, true, true]);
  assert.equal(empty.hidden, false);
  assert.equal(status.textContent, '顯示 0 則新聞');

  click(news.querySelectorAll('.chip')[0]);
  assert.equal(list.classList.contains('is-collapsed'), true);
  click(more);
  assert.equal(more.dataset.expanded, '1');
  assert.equal(more.hidden, true);
  assert.equal(list.classList.contains('is-collapsed'), false);
});

test('chart-switch: a choice shows the chosen element of that group only; other groups and other cards are untouched', () => {
  const registry = loadComponents();
  const card = (group: string): Spec => ['chart-switch', {}, [
    chips(group, ['TW', 'ww']),
    ['figure', { 'data-chart-group': group, 'data-value': 'TW' }],
    ['p', { 'data-chart-group': group, 'data-value': 'TW' }],
    ['figure', { 'data-chart-group': group, 'data-value': 'ww', hidden: '' }],
    ['p', { 'data-chart-group': 'other', 'data-value': 'TW' }],
  ]];
  const root = build(registry, ['div', {}, [card('share-ios'), card('share-android')]]);
  connectAll(root);
  const [ios, android] = root.querySelectorAll('chart-switch');
  click(ios.querySelectorAll('.chip')[1]);
  assert.deepEqual(ios.querySelectorAll('[data-chart-group]').map(el => el.hidden), [true, true, false, false]);
  assert.deepEqual(android.querySelectorAll('[data-chart-group]').map(el => el.hidden), [false, false, true, false], 'the other card keeps its state');
});

test('line-chart: tolerates a missing figure, missing parts or unreadable data without throwing', () => {
  const registry = loadComponents();
  for (const kids of [[], [['figure', { class: 'chart', 'data-chart': '{}' }]], [['figure', { class: 'chart', 'data-chart': 'not json' }, [['svg'], ['line', { class: 'chart-cross' }], ['div', { class: 'chart-tip' }], ['div', { class: 'chart-plot' }]]]]] as Spec[][]) {
    assert.doesNotThrow(() => connectAll(build(registry, ['line-chart', {}, kids])));
  }
});

test('line-chart: the pointer or, with the chart focused, the arrow keys pick the month shown; leaving hides it', () => {
  const registry = loadComponents();
  const data = { x: ['2026/08', '2026/09', '2026/10'], unit: '%', series: [{ name: 'iOS 26', slot: 1, values: [10, 20.5, null] }] };
  const chart = build(registry, ['line-chart', {}, [['figure', { class: 'chart', 'data-chart': JSON.stringify(data) }, [
    ['div', { class: 'chart-plot' }, [
      ['svg', {}, [
        ['line', { class: 'chart-cross', visibility: 'hidden' }],
        ...data.x.map((_, i): Spec => ['rect', { class: 'chart-hit', 'data-i': String(i), 'data-cx': String(100 + i * 200) }]),
      ]],
      ['div', { class: 'chart-tip', 'aria-hidden': 'true', hidden: '' }],
    ]],
  ]]]]);
  connectAll(chart);
  const svg = chart.querySelector('svg')!;
  const tip = chart.querySelector('.chart-tip')!;
  const cross = chart.querySelector('.chart-cross')!;
  const shown = () => tip.hidden ? null : `${tip.querySelector('strong')?.textContent} ${tip.querySelectorAll('span').map(s => s.textContent).join(' ')} @${cross.getAttribute('x1')}`;
  const key = (k: string) => {
    const event = Object.assign(new FakeEvent('keydown'), { key: k, defaultPrevented: false, preventDefault() { event.defaultPrevented = true; } });
    svg.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(svg.getAttribute('tabindex'), '0', 'focusable once script runs');

  const hits = chart.querySelectorAll('.chart-hit');
  hits[1].dispatchEvent(new FakeEvent('pointerover', { bubbles: true }));
  assert.equal(shown(), '2026/09  iOS 26 20.5% @300');
  svg.dispatchEvent(new FakeEvent('pointerleave'));
  assert.equal(shown(), null);
  assert.equal(cross.getAttribute('visibility'), 'hidden');

  svg.dispatchEvent(new FakeEvent('focus'));
  assert.equal(shown(), '2026/09  iOS 26 20.5% @300', 'focus shows the month last shown');
  assert.equal(key('ArrowRight'), true);
  assert.equal(shown(), '2026/10  iOS 26 — @500', 'a missing value shows as a dash');
  key('ArrowRight');
  assert.equal(shown(), '2026/10  iOS 26 — @500', 'stops at the last month');
  key('Home');
  assert.equal(shown(), '2026/08  iOS 26 10% @100');
  key('ArrowLeft');
  assert.equal(shown(), '2026/08  iOS 26 10% @100', 'stops at the first month');
  key('End');
  assert.equal(shown(), '2026/10  iOS 26 — @500');
  assert.equal(key('Tab'), false, 'other keys are left alone');
  svg.dispatchEvent(new FakeEvent('blur'));
  assert.equal(shown(), null);
});


test('choice-chips: the arrow keys, Home and End move the choice like radio buttons, wrapping around', () => {
  const registry = loadComponents();
  const root = build(registry, ['div', {}, [chips('platform', ['all', 'iOS', 'Android'])]]);
  connectAll(root);
  const group = root.querySelector('choice-chips')!;
  const [all, ios, android] = group.querySelectorAll('.chip');
  const seen: unknown[] = [];
  root.addEventListener('choice-change', e => seen.push((e.detail as ChoiceChangeDetail).value));
  assert.equal(key(all, 'ArrowRight'), true);
  assert.equal(fakeFocus.current, ios, 'focus moves with the choice');
  assert.deepEqual(state(group), ['all:false:false:-1', 'iOS:true:true:0', 'Android:false:false:-1']);
  key(ios, 'ArrowDown');
  key(android, 'ArrowRight');
  assert.equal(fakeFocus.current, all, 'past the last: the first');
  key(all, 'ArrowLeft');
  assert.equal(fakeFocus.current, android, 'before the first: the last');
  key(android, 'Home');
  key(all, 'End');
  assert.deepEqual(seen, ['iOS', 'Android', 'all', 'Android', 'all', 'Android']);
  assert.equal(key(android, 'Tab'), false, 'other keys are left alone');
  assert.equal(seen.length, 6);
});

/** A page for <page-search>: the header input, the status line, and sections of rows */
function searchPage(registry: ReturnType<typeof loadComponents>) {
  const root = build(registry, ['page-search', { skip: 'now', 'jump-to': 'now' }, [
    ['activity-filter', { filters: 'type' }, [
      ['input', { 'data-page-search': '', 'data-activity-search': '', value: '' }],
      ['p', { 'data-search-status': '', hidden: '' }, [['span', { 'data-search-summary': '' }], ['button', { 'data-search-clear': '' }]]],
      ['main', {}, [
        ['section', { id: 'now' }, [['ul', { 'data-search-rows': '' }, [['li', { 'data-feed-item': '' }]]]]],
        ['section', { id: 'tools' }, [
          ['div', { class: 'case' }, [
            ['div', { class: 'case-head' }],
            ['ul', { 'data-search-rows': '' }, [['li'], ['li']]],
          ]],
          ['h3'],
          ['p', { class: 'table-note' }],
          ['div', { class: 'table-wrap' }, [['table', {}, [['tbody', { 'data-search-rows': '' }, [['tr'], ['tr']]]]]]],
        ]],
        ['section', { id: 'legal' }],
      ]],
    ]],
  ]]);
  const [now, tools, legal] = root.querySelectorAll('section');
  now.querySelector('li')!.textContent = 'Xcode deadline';
  tools.querySelector('.case-head')!.textContent = 'AGP';
  ['Xcode 26 required', 'Gradle 9'].forEach((t, i) => { tools.querySelectorAll('.case li')[i].textContent = t; });
  ['iOS 26 SDK', 'targetSdk 36'].forEach((t, i) => { tools.querySelectorAll('tr')[i].textContent = t; });
  legal.textContent = 'Disclaimer about Xcode';
  // The table's heading: the element before it, skipping notes
  tools.querySelector('h3')!.textContent = 'Android SDK';
  tools.querySelector('.table-note')!.textContent = 'a note';
  return { root, now, tools, legal };
}

test('page-search: rows, cards and sections that don\'t match hide; a matching heading keeps its rows; the address keeps the search', () => {
  const registry = loadComponents();
  const { root, now, tools, legal } = searchPage(registry);
  registry.page.body.append(root);
  connectAll(root);
  const search = root.querySelector('input')!;
  const status = root.querySelector('[data-search-status]')!;
  const type = (q: string) => {
    search.value = q;
    search.dispatchEvent(new FakeEvent('input'));
    registry.page.advance(120);
  };
  const misses = (el: FakeElement) => el.querySelectorAll('[data-search-rows] > *').map(r => r.classList.contains('search-miss'));

  type('xcode');
  assert.deepEqual(misses(tools), [false, true, true, true]);
  assert.equal(tools.querySelector('.table-wrap')!.classList.contains('search-miss'), true, 'a table with no row left hides');
  assert.equal(tools.classList.contains('search-miss'), false);
  assert.equal(legal.classList.contains('search-miss'), false, 'a section without rows matches on its text');
  assert.equal(now.querySelector('li')!.classList.contains('search-miss'), false, 'skipped sections are the activity filter\'s');
  assert.equal(registry.page.body.classList.contains('searching'), true);
  assert.equal(status.hidden, false);
  assert.equal(status.querySelector('[data-search-summary]')!.textContent, '「xcode」：待處理與動態 1 筆，其他區塊 1 筆');
  assert.equal(registry.page.location.search, '?search=xcode');

  type('AGP');
  assert.deepEqual(misses(tools), [false, false, true, true], 'the card named AGP keeps all its rows');
  assert.equal(legal.classList.contains('search-miss'), true);

  // The rows' text is read once: a change afterwards isn't searched
  tools.querySelectorAll('tr')[0].textContent = 'AGP 9';
  type('agp');
  assert.deepEqual(misses(tools), [false, false, true, true]);

  click(status.querySelector('[data-search-clear]')!);
  registry.page.advance(120);
  assert.deepEqual(misses(tools), [false, false, false, false]);
  assert.equal(registry.page.body.classList.contains('searching'), false);
  assert.equal(status.hidden, true);
  assert.equal(registry.page.location.search, '');
  assert.equal(fakeFocus.current, search, 'clearing returns to the box');

  assert.equal(key(search, 'Enter'), false);
  assert.ok(now.hasAttribute('data-scrolled-to'), 'Enter jumps to the jump-to section');
  fakeFocus.current = null;
  assert.equal(key(registry.page.document, '/'), true);
  assert.equal(fakeFocus.current, search, '"/" focuses the search');
  fakeFocus.current = null;
  assert.equal(key(search, '/'), false, 'typing "/" in a field is left alone');
});

test('page-search: a search in the address runs on setup, the activity filter included', () => {
  const registry = loadComponents('https://example.com/?search=Gradle#tools');
  const { root, tools } = searchPage(registry);
  registry.page.body.append(root);
  connectAll(root);
  assert.equal(root.querySelector('input')!.value, 'Gradle');
  registry.page.advance(120);
  assert.deepEqual(tools.querySelectorAll('[data-search-rows] > *').map(r => r.classList.contains('search-miss')), [true, false, true, true]);
  assert.equal(root.querySelector('[data-feed-item]')!.hidden, true, 'the activity filter heard it too');
  assert.match(root.querySelector('[data-search-summary]')!.textContent, /待處理與動態 0 筆，其他區塊 1 筆/);
});

test('section-nav: marks the first section in view, or the last one at the very bottom', () => {
  const registry = loadComponents();
  const ids = ['a', 'b', 'c'];
  const nav = build(registry, ['section-nav', {}, [['nav', {}, ids.map((id): Spec => ['a', { href: `#${id}` }])]]]);
  const sections = ids.map(id => build(registry, ['section', { id }]));
  registry.page.body.append(nav, ...sections);
  connectAll(nav);
  const [observer] = registry.page.observers;
  const links = nav.querySelectorAll('a');
  const current = () => links.map(a => `${a.classList.contains('is-current')}:${a.getAttribute('aria-current')}`);
  const place = (...tops: number[]) => tops.forEach((top, i) => { sections[i].rect = { top, height: 500 }; });
  place(-900, 100, 600); // b's top is in the upper 40% of the 800px screen
  observer.callback([]);
  assert.deepEqual(current(), ['false:null', 'true:true', 'false:null']);
  place(-1500, -500, 200);
  observer.callback([]);
  assert.deepEqual(current(), ['false:null', 'false:null', 'true:true']);
  // A jump far down: no observer event for the sections passed, the next scroll still finds c
  place(-4000, -3000, 50);
  registry.page.win.dispatchEvent(new FakeEvent('scroll'));
  assert.deepEqual(current(), ['false:null', 'false:null', 'true:true']);
  sections[2].classList.add('search-miss');
  place(-4000, 100, 0);
  observer.callback([]);
  assert.deepEqual(current(), ['false:null', 'true:true', 'false:null'], 'a section the search hid is skipped');
  sections[2].classList.remove('search-miss');
  place(-4000, -3000, 200);
  registry.page.win.scrollY = 4200;
  registry.page.win.dispatchEvent(new FakeEvent('scroll'));
  assert.deepEqual(current(), ['false:null', 'false:null', 'true:true'], 'at the bottom: the last');
  (nav as unknown as { disconnectedCallback(): void }).disconnectedCallback();
  assert.equal(observer.targets.length, 0, 'disconnecting stops observing');
});

/** A notification center around the given items, as render.ts writes it */
function notifCenter(registry: ReturnType<typeof loadComponents>, items: unknown[]) {
  const root = build(registry, ['notif-center', {}, [['div', { class: 'notif' }, [
    ['button', { 'data-notif-bell': '', 'aria-expanded': 'false' }, [['span', { 'data-notif-badge': '', hidden: '' }]]],
    ['div', { 'data-notif-panel': '', hidden: '' }, [
      ['button', { 'data-notif-mark-read': '' }],
      ['ul', { 'data-notif-list': '' }],
    ]],
    ['script', { 'data-notif-items': '' }],
  ]]]]);
  root.querySelector('script')!.textContent = JSON.stringify({ cachedAt: '2026-10-26T00:00:00Z', items });
  registry.page.body.append(root);
  return root;
}

test('notif-center: items without a link are buttons, so the keyboard can mark them read; focus goes into the panel and back', () => {
  const registry = loadComponents();
  const recent = new Date().toISOString();
  const root = notifCenter(registry, [
    { id: 'a', kind: 'deadline', platform: 'iOS', title: 'Xcode 26 required', url: 'https://developer.apple.com/news/', date: '2026-10-20', firstSeen: recent },
    { id: 'b', kind: 'security', platform: 'Android', title: 'CVE <b>', url: 'javascript:alert(1)', date: '2026-10-21', firstSeen: recent },
    { id: 'c', kind: 'crash', platform: 'iOS', title: 'Old crash', date: '2020-01-01' },
  ]);
  connectAll(root);
  const bell = root.querySelector('[data-notif-bell]')!;
  const badge = root.querySelector('[data-notif-badge]')!;
  const panel = root.querySelector('[data-notif-panel]')!;
  const entries = root.querySelectorAll('.notif-entry');
  assert.deepEqual(entries.map(e => e.tagName), ['a', 'button', 'button'], 'an unsafe or missing link makes a button');
  assert.equal((entries[0] as unknown as { href: string }).href, 'https://developer.apple.com/news/');
  assert.equal(entries[1].querySelector('.notif-title')!.textContent, 'CVE <b>', 'titles are text, never markup');
  assert.deepEqual(root.querySelectorAll('.notif-item').map(li => li.classList.contains('unread')), [true, true, false], 'first visit: only the last 7 days are unread');
  assert.equal(badge.textContent, '2');
  assert.equal(bell.getAttribute('aria-label'), '通知，2 則未讀');

  click(bell);
  assert.equal(panel.hidden, false);
  assert.equal(bell.getAttribute('aria-expanded'), 'true');
  assert.equal(fakeFocus.current, entries[0], 'opening moves focus to the first item');
  click(entries[1]);
  assert.equal(entries[1].closest('.notif-item')!.classList.contains('unread'), false);
  assert.equal(badge.textContent, '1');
  assert.deepEqual(JSON.parse(registry.page.storage.get('notif-read')!).sort(), ['b', 'c']);

  key(entries[1], 'Escape');
  assert.equal(panel.hidden, true);
  assert.equal(fakeFocus.current, bell, 'Escape returns focus to the bell');
  click(bell);
  click(registry.page.document.body);
  assert.equal(panel.hidden, true, 'a click outside closes it');

  click(root.querySelector('[data-notif-mark-read]')!);
  assert.equal(badge.hidden, true);
  assert.equal(bell.getAttribute('aria-label'), '通知');
});

test('app.js: a part that throws while loading is reported, and the parts after it still run', () => {
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args[0]); };
  try {
    const registry = loadComponents('https://example.com/', [['boom.js', 'throw new Error("boom")'], ['after.js', 'defineElement("after-boom", class extends LightElement { setup() {} });']]);
    assert.ok(registry.has('after-boom'), 'the part after it ran, with the shared globals');
    assert.ok(registry.has('choice-chips'));
    assert.deepEqual(errors, ['boom.js', 'boom.js'], 'reported with its name (loaded twice)');
  } finally {
    console.error = original;
  }
  // Every part but the shared ones is wrapped; the shared ones are not, so their declarations stay global
  const app = readScript('app.js').toString();
  for (const part of APP_PARTS) {
    const wrapped = app.includes(`// ---- ${part} ----\ntry {\n`);
    assert.equal(wrapped, !['light-element.js', 'toasts.js', 'safe-link.js'].includes(part), part);
  }
});

test('section-nav: a link whose section isn\'t on the page is hidden', () => {
  const registry = loadComponents();
  const nav = build(registry, ['section-nav', {}, [['nav', {}, [['a', { href: '#here' }], ['a', { href: '#gone' }]]]]]);
  registry.page.body.append(nav, build(registry, ['section', { id: 'here' }]));
  connectAll(nav);
  assert.deepEqual(nav.querySelectorAll('a').map(a => a.hidden), [false, true]);
  assert.deepEqual(registry.page.observers[0].targets.map(t => t.id), ['here']);
});

test('notif-center: focus leaving it closes the panel; leaving the window doesn\'t; toasts have no live region of their own', () => {
  const registry = loadComponents();
  const root = notifCenter(registry, [{ id: 'a', kind: 'deadline', platform: 'iOS', title: 'T', date: '2026-10-20', firstSeen: new Date().toISOString() }]);
  const outside = Object.assign(new FakeElement(), { tagName: 'button' });
  registry.page.body.append(outside);
  connectAll(root);
  const bell = root.querySelector('[data-notif-bell]')!;
  const panel = root.querySelector('[data-notif-panel]')!;
  const entry = root.querySelector('.notif-entry')!;
  const focusout = (relatedTarget: FakeElement | null) => entry.dispatchEvent(Object.assign(new FakeEvent('focusout', { bubbles: true }), { relatedTarget }));
  click(bell);
  focusout(bell);
  assert.equal(panel.hidden, false, 'within the notification center: stays open');
  focusout(null);
  assert.equal(panel.hidden, false, 'the window lost focus: stays open');
  focusout(outside);
  assert.equal(panel.hidden, true, 'focus elsewhere on the page: closed');

  const stack = Object.assign(new FakeElement(), { tagName: 'div' });
  stack.setAttribute('id', 'toasts');
  registry.page.body.append(stack);
  const run = new Function('document', 'setTimeout', `${readPart('toasts.js')}\nreturn showToast;`)(registry.page.document, () => 0) as (m: string) => FakeElement;
  const toast = run('hello');
  assert.equal(toast.getAttribute('role'), null);
  assert.equal(toast.parentElement, stack);
});

test('safe links: the browser\'s check agrees with the server\'s safeUrl on every case', async () => {
  const { safeUrl } = await import('../src/safe-url.ts');
  const safeLinkUrl = new Function(`${readPart('safe-link.js')}\nreturn safeLinkUrl;`)() as (raw: unknown) => string | null;
  const cases: unknown[] = [
    'https://developer.apple.com/news/', 'http://example.com/a?b=c#d', '  https://example.com/trimmed  ', 'HTTPS://EXAMPLE.COM/Up',
    'javascript:alert(1)', 'data:text/html,x', 'ftp://example.com/', '//example.com/', '/relative', '', '   ',
    'https://developer.apple.com@evil.example/', 'https://user:pass@example.com/', 'https://exa mple.com/',
    'https://example.com/\u0000', 'https://example.com/\n', 'https://example.com/\u0085', 'https://example.com/\u009f',
    'not a url', null, undefined, 42, {},
  ];
  for (const raw of cases) assert.equal(safeLinkUrl(raw), safeUrl(raw), JSON.stringify(String(raw)));
});

test('notif-center: the type label and platform tag come from the data, so the browser keeps no copy of them', async () => {
  const { buildNotificationsJson, KIND_LABEL } = await import('../src/changes.ts');
  const kinds = Object.keys(KIND_LABEL) as Array<keyof typeof KIND_LABEL>;
  const items = JSON.parse(buildNotificationsJson(kinds.map((kind, i) => ({ id: `n${i}`, kind, platform: (['iOS', 'Android', '跨平台'] as const)[i % 3], title: `T${i}`, detail: '', url: 'https://example.com/', date: '2026-10-20' })), '2026-10-26T00:00:00Z')).items;
  assert.deepEqual(items.map((i: { kindLabel: string }) => i.kindLabel).sort(), Object.values(KIND_LABEL).sort(), 'every kind is named');
  const registry = loadComponents();
  const root = notifCenter(registry, items);
  connectAll(root);
  const first = root.querySelector('.notif-entry')!;
  const tag = first.querySelector('.tl-platform')!;
  const item = items.find((i: { id: string }) => i.id === first.dataset.id);
  assert.equal(tag.className, `tl-platform ${item.platformClass}`);
  assert.match(item.platformClass, /^tl-(ios|android|cross)$/);
  assert.equal(tag.parentElement!.children[1].textContent, item.kindLabel);
  assert.doesNotMatch(readPart('notif-center.js').toString(), /期限|tl-ios/, 'no names or classes of its own');
});


test('toasts: an action\'s click stops at the toast; the timer pauses while pointed at or focused, and starts over after', () => {
  const registry = loadComponents();
  const stack = Object.assign(new FakeElement(), { tagName: 'div' });
  stack.setAttribute('id', 'toasts');
  registry.page.body.append(stack);
  const { globals, advance } = registry.page;
  const showToast = new Function('document', 'setTimeout', 'clearTimeout', 'Node', 'Element', 'HTMLElement', `${readPart('toasts.js')}\nreturn showToast;`)(
    registry.page.document, globals.setTimeout, globals.clearTimeout, FakeElement, FakeElement, FakeElement,
  ) as (m: string, o?: object) => FakeElement;
  let heard = 0;
  registry.page.body.addEventListener('click', () => { heard++; });
  let ran = 0;
  const toast = showToast('hi', { actions: [{ label: 'Go', run: () => { ran++; } }], timeout: 1000 });
  click(toast.querySelector('.toast-action')!);
  assert.equal(ran, 1);
  assert.equal(heard, 0, 'the page never hears the click (it would close a panel the action just opened)');
  assert.equal(toast.parentElement, null, 'the toast closes after its action');

  const slow = showToast('read me', { timeout: 1000 });
  slow.dispatchEvent(new FakeEvent('mouseenter'));
  advance(5000);
  assert.equal(slow.parentElement, stack, 'stays while pointed at');
  slow.dispatchEvent(new FakeEvent('focusin'));
  slow.dispatchEvent(new FakeEvent('mouseleave'));
  advance(5000);
  assert.equal(slow.parentElement, stack, 'and while focused');
  slow.dispatchEvent(Object.assign(new FakeEvent('focusout'), { relatedTarget: null }));
  advance(999);
  assert.equal(slow.parentElement, stack, 'the full time again');
  advance(1);
  assert.equal(slow.parentElement, null);

  // Closed from the keyboard: focus goes back where it came from, not to <body>
  const before = Object.assign(new FakeElement(), { tagName: 'button' });
  registry.page.body.append(before);
  const closable = showToast('bye', { closable: true, timeout: 1000 });
  const close = closable.querySelector('.toast-close')!;
  closable.dispatchEvent(Object.assign(new FakeEvent('focusin'), { relatedTarget: before }));
  fakeFocus.current = close;
  click(close);
  assert.equal(closable.parentElement, null);
  assert.equal(fakeFocus.current, before);
});

test('capped lists: each component takes its own list\'s cap; "show more" marks itself wired and moves focus to the first revealed row', () => {
  const registry = loadComponents();
  const page = build(registry, ['activity-filter', { filters: 'type' }, [
    chips('type', ['all', 'security']),
    ['section', { id: 'feed' }, [['ul', {}, [['li', { 'data-feed-item': '', 'data-type': 'security' }]]]]],
    ['news-list', { filters: 'news' }, [
      chips('news', ['all', 'iOS']),
      ['div', {}, [
        ['ul', { 'data-news-items': '', 'data-capped': '', class: 'is-collapsed' }, [
          ['li', { 'data-news': 'iOS' }], ['li', { 'data-news': 'iOS', class: 'list-extra' }, [['a', { href: 'https://example.com/' }]]],
        ]],
        ['button', { 'data-show-more': '' }],
      ]],
    ]],
  ]]);
  connectAll(page);
  const news = page.querySelector('[data-news-items]')!;
  const more = page.querySelector('[data-show-more]')!;
  assert.equal(more.hasAttribute('data-wired'), true, 'theme.js can tell this button works');
  click(page.querySelectorAll('choice-chips')[0].querySelectorAll('.chip')[1]);
  assert.equal(news.classList.contains('is-collapsed'), true, 'the activity filter (feed not capped) leaves the news cap alone');
  assert.equal(more.hidden, false);
  click(more);
  assert.equal(news.classList.contains('is-collapsed'), false);
  assert.equal(fakeFocus.current, news.querySelectorAll('li')[1].querySelector('a'), 'focus goes to the first row "more" revealed, not to <body>');
});

test('filters: a chip group named like the filter\'s own, but inside a nested filter, doesn\'t drive it', () => {
  const registry = loadComponents();
  const outer = build(registry, ['activity-filter', { filters: 'type' }, [
    chips('type', ['all', 'security']),
    ['section', { id: 'feed' }, [['ul', {}, [['li', { 'data-feed-item': '', 'data-type': 'news' }]]]]],
    ['bank-table', { filters: 'type' }, [
      chips('type', ['all', 'personal']),
      ['table', {}, [['tbody', {}, [['tr', { 'data-type': 'personal', 'data-index': '0' }]]]]],
    ]],
  ]]);
  connectAll(outer);
  click(outer.querySelector('bank-table')!.querySelectorAll('.chip')[1]);
  assert.equal(outer.querySelector('[data-feed-item]')!.hidden, false, 'the bank\'s group is the bank table\'s alone');
  assert.equal(registry.page.location.search, '?f-type=personal');
});

test('page-search: a row another filter hides is no hit, and a filter change under a search updates which sections are left', () => {
  const registry = loadComponents();
  const root = build(registry, ['page-search', {}, [
    ['input', { 'data-page-search': '' }],
    ['main', {}, [['section', { id: 'news' }, [['ul', { 'data-search-rows': '' }, [['li', {}], ['li', { hidden: '' }]]]]]]],
  ]]);
  const rows = root.querySelectorAll('li');
  rows[0].textContent = 'iOS release';
  rows[1].textContent = 'Android beta';
  const missing: unknown[] = [];
  registry.page.body.append(root);
  registry.page.body.addEventListener('page-searched', e => missing.push(e.detail));
  connectAll(root);
  const search = root.querySelector('input')!;
  search.value = 'android';
  search.dispatchEvent(new FakeEvent('input'));
  registry.page.advance(120);
  const section = root.querySelector('section')!;
  assert.equal(section.classList.contains('search-miss'), true, 'its only match is filtered out: nothing to show');
  assert.deepEqual(missing.at(-1), { missing: ['news'] });
  rows[1].hidden = false;
  rows[1].dispatchEvent(new FakeEvent('rows-changed', { bubbles: true }));
  assert.equal(section.classList.contains('search-miss'), false, 'the filter let it through: the section is back');
  assert.deepEqual(missing.at(-1), { missing: [] });
});

test('section-nav: links to the sections a search emptied hide until the search changes', () => {
  const registry = loadComponents();
  const nav = build(registry, ['section-nav', {}, [['nav', {}, [['a', { href: '#a' }], ['a', { href: '#b' }]]]]]);
  registry.page.body.append(nav, build(registry, ['section', { id: 'a' }]), build(registry, ['section', { id: 'b' }]));
  connectAll(nav);
  registry.page.document.dispatchEvent(new FakeEvent('page-searched', { detail: { missing: ['b'] } }));
  assert.deepEqual(nav.querySelectorAll('a').map(a => a.hidden), [false, true]);
  registry.page.document.dispatchEvent(new FakeEvent('page-searched', { detail: { missing: [] } }));
  assert.deepEqual(nav.querySelectorAll('a').map(a => a.hidden), [false, false]);
});

test('components: a setup that throws drops what it had attached, so the next connection starts clean', () => {
  const registry = loadComponents('https://example.com/', [['test-part.js', `
    let attempts = 0;
    defineElement('flaky-thing', class extends LightElement {
      setup(signal) {
        attempts++;
        this.addEventListener('ping', () => { this.dataset.pings = String(Number(this.dataset.pings ?? 0) + 1); }, { signal });
        if (attempts === 1) throw new Error('not ready');
        return true;
      }
    });`]]);
  const el = build(registry, ['flaky-thing']) as FakeElement & { connectedCallback(): void };
  assert.throws(() => el.connectedCallback(), /not ready/, 'the browser reports it and carries on');
  el.connectedCallback();
  el.dispatchEvent(new FakeEvent('ping'));
  assert.equal(el.dataset.pings, '1', 'one listener: the one from the failed setup was dropped');
});

test('notif-center polling: the same items twice pop nothing; a new one pops one toast; a quick return to the tab doesn\'t refetch', async t => {
  let now = Date.parse('2026-10-26T00:00:00Z');
  t.mock.method(Date, 'now', () => now);
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  const item = (id: string) => ({ id, kind: 'deadline', platform: 'iOS', title: `T ${id}`, date: '2026-10-20', firstSeen: '2026-10-25T00:00:00Z' });
  let served = [item('a')];
  let fetches = 0;
  globalThis.fetch = (async () => { fetches++; return Response.json({ cachedAt: '2026-10-26T00:00:00Z', items: served }); }) as typeof fetch;
  const registry = loadComponents();
  const stack = Object.assign(new FakeElement(), { tagName: 'div' });
  stack.setAttribute('id', 'toasts');
  registry.page.body.append(stack);
  const root = notifCenter(registry, [item('a')]);
  connectAll(root);
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };

  now += 6 * 60_000;
  registry.page.advance(5 * 60_000);
  await settle();
  assert.equal(fetches, 1);
  assert.equal(stack.children.length, 0, 'nothing new: no toast');

  served = [item('b'), item('a')];
  now += 30_000;
  registry.page.document.dispatchEvent(new FakeEvent('visibilitychange'));
  await settle();
  assert.equal(fetches, 1, 'back to the tab half a minute later: no new request');

  now += 2 * 60_000;
  registry.page.document.dispatchEvent(new FakeEvent('visibilitychange'));
  await settle();
  assert.equal(fetches, 2);
  assert.equal(stack.children.length, 1, 'one new item: one toast');
  assert.match(stack.children[0].textContent, /1 項新通知/);
  now += 2 * 60_000;
  registry.page.document.dispatchEvent(new FakeEvent('visibilitychange'));
  await settle();
  assert.equal(stack.children.length, 1, 'the same item again: no second toast');
});

test('toasts: closing one that never had focus leaves focus where it is', () => {
  const registry = loadComponents();
  const stack = Object.assign(new FakeElement(), { tagName: 'div' });
  stack.setAttribute('id', 'toasts');
  registry.page.body.append(stack);
  const { globals } = registry.page;
  const showToast = new Function('document', 'setTimeout', 'clearTimeout', 'Node', 'Element', 'HTMLElement', `${readPart('toasts.js')}\nreturn showToast;`)(
    registry.page.document, globals.setTimeout, globals.clearTimeout, FakeElement, FakeElement, FakeElement,
  ) as (m: string, o?: object) => FakeElement;
  const input = Object.assign(new FakeElement(), { tagName: 'input' });
  registry.page.body.append(input);
  fakeFocus.current = input;
  const toast = showToast('x', { closable: true });
  click(toast.querySelector('.toast-close')!);
  assert.equal(fakeFocus.current, input);
});

test('a sideways scroller at its edge lets the wheel scroll the page', () => {
  const registry = loadComponents();
  const group = build(registry, chips('type', ['all', 'a', 'b']));
  const row = group.querySelector('.chips')! as FakeElement & { scrollWidth: number; clientWidth: number; scrollLeft: number };
  Object.assign(row, { scrollWidth: 500, clientWidth: 300, scrollLeft: 200 });
  connectAll(group);
  const wheel = (deltaY: number) => {
    const event = Object.assign(new FakeEvent('wheel', { bubbles: true }), { deltaY, deltaX: 0 });
    row.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(wheel(100), false, 'at the right end: the page scrolls');
  assert.equal(wheel(-100), true, 'back towards the start: the row scrolls');
  assert.equal(row.scrollLeft, 100);
});
