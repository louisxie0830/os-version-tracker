import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { COMPONENT_SCRIPTS, readScript, scriptPath } from '../src/asset-versions.ts';
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
const TAGS = ['choice-chips', 'bank-table', 'news-list', 'chart-switch', 'line-chart'];

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
    assert.match(html, new RegExp(`<choice-chips name="${group}"><div class="chips" role="group" data-filter-group="${group}">\\s*<button type="button" class="chip is-active" data-value="all" aria-pressed="true">全部</button>`));
  }
  const bankGroups = [...html.matchAll(/data-bank-filter="(\w+)"/g)].map(m => m[1]);
  assert.ok(bankGroups.length >= 2, 'the fixture has bank filters');
  for (const group of bankGroups) assert.match(html, new RegExp(`<choice-chips name="${group}"><div class="chips" role="group" aria-label="[^"]+" data-bank-filter="${group}">`));
  // Every generic .chips group on the page is a choice-chips
  const groups = html.match(/<div class="chips[^"]*" role="group"/g) ?? [];
  assert.equal(groups.length, (html.match(/<choice-chips name="[^"]+"><div class="chips/g) ?? []).length);
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
  const inner = html.match(/<news-list filter-name="news">([\s\S]*?)<\/news-list>/)?.[1] ?? '';
  assert.match(inner, /<choice-chips name="news"><div class="news-filters"/);
  assert.match(inner, /data-value="all" aria-pressed="true"/);
  assert.match(inner, /<ul class="news news-feed" id="news-list" data-news-items>/);
  assert.match(inner, /data-news-more/);
  assert.match(inner, /data-news-empty hidden>沒有符合的新聞/);
});

test('banks: one bank-table wraps the filters, the sort, the count, the table and the empty message', () => {
  const html = renderHTML(snapshot);
  const inner = html.match(/<bank-table>([\s\S]*?)<\/bank-table>/)?.[1] ?? '';
  for (const hook of ['class="bank-filters"', '<select id="bank-sort" data-bank-sort>', 'id="bank-count" data-bank-count', '<tbody id="bank-rows">', 'id="bank-empty" data-bank-empty hidden']) {
    assert.ok(inner.includes(hook), hook);
  }
  assert.equal(html.match(/<bank-table>/g)?.length, 1);
  // The sort options declare the row dataset key and direction they order by; bank-table.js knows no names
  const options = [...inner.matchAll(/<option value="(\w+)"( data-sort-key="(\w+)" data-sort-dir="(asc|desc)")?>/g)];
  assert.deepEqual(options.map(m => [m[1], m[3], m[4]]), [
    ['default', undefined, undefined],
    ['ios', 'iosSort', 'desc'],
    ['android', 'androidSort', 'desc'],
    ['target', 'targetSort', 'asc'],
  ], 'first option keeps the page order; the rest in a fixed order');
  const rowAttrs = inner.match(/<tr data-index="0"[^>]*>/)?.[0] ?? '';
  for (const [, , , key] of options.filter(m => m[3])) {
    assert.match(rowAttrs, new RegExp(` data-${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}="-?[\\d.]+"`), `${key}: every row carries it`);
  }
  for (const source of [readScript('bank-table.js').toString(), readFileSync(new URL('../src/browser/bank-table.ts', import.meta.url), 'utf8')]) {
    assert.doesNotMatch(source, /iosSort|androidSort|targetSort|'ios'|'android'|'target'/, 'the controller is generic');
  }
  // Inside the section, so the whole-page search still walks it as part of #banks
  assert.match(html, /<section class="panel" id="banks">[\s\S]*<bank-table>[\s\S]*<\/bank-table>[\s\S]*?<\/section>/);
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

test('the components are written in TypeScript only: src/browser/*.ts compiled to classic scripts in dist/browser/', () => {
  for (const name of COMPONENT_SCRIPTS) {
    const source = new URL(`../src/browser/${name.replace(/\.js$/, '.ts')}`, import.meta.url);
    assert.ok(existsSync(source), `${name}: its TypeScript source`);
    assert.ok(!existsSync(new URL(`../public/${name}`, import.meta.url)), `${name}: no hand-kept copy in public/`);
    assert.match(scriptPath(name), /[/\\]dist[/\\]browser[/\\][\w-]+\.js$/, `${name}: served from the compiled output`);
    const js = readScript(name).toString();
    // Loaded with <script defer>, not as a module: an import, export or CommonJS export would break it
    assert.doesNotMatch(js, /^\s*(import|export)\b|\bexports\b|\brequire\(/m, `${name}: a classic script`);
    assert.match(js, /customElements\.define\(/, `${name}: the compiled component`);
  }
});

// ---------- behaviour, against a small fake DOM ----------

const camel = (s: string) => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

class FakeEvent {
  target: FakeElement | null = null;
  bubbles: boolean;
  detail: unknown;
  constructor(public type: string, init: { bubbles?: boolean; detail?: unknown } = {}) {
    this.bubbles = !!init.bubbles;
    this.detail = init.detail;
  }
}

class FakeElement {
  tagName = '';
  attrs = new Map<string, string>();
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  textContent = '';
  listeners = new Map<string, Array<(e: FakeEvent) => void>>();
  dataset: Record<string, string> = new Proxy({}, {
    get: (_, key) => [...this.attrs].find(([k]) => k.startsWith('data-') && camel(k.slice(5)) === key)?.[1],
    set: (_, key, value) => { this.attrs.set(`data-${String(key).replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`, String(value)); return true; },
  });
  classList = {
    contains: (c: string) => (this.attrs.get('class') ?? '').split(' ').includes(c),
    toggle: (c: string, on: boolean) => {
      const list = (this.attrs.get('class') ?? '').split(' ').filter(x => x && x !== c);
      this.attrs.set('class', [...list, ...(on ? [c] : [])].join(' '));
    },
  };
  get hidden() { return this.attrs.has('hidden'); }
  set hidden(v: boolean) { if (v) this.attrs.set('hidden', ''); else this.attrs.delete('hidden'); }
  get rows() { return this.children.filter(c => c.tagName === 'tr'); }
  get value() { return this.attrs.get('value') ?? ''; }
  set value(v: string) { this.attrs.set('value', v); }
  getAttribute(name: string) { return this.attrs.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.attrs.set(name, String(value)); }
  append(...nodes: FakeElement[]) {
    for (const n of nodes) {
      if (n.parentElement) n.parentElement.children = n.parentElement.children.filter(c => c !== n);
      n.parentElement = this;
      this.children.push(n);
    }
  }
  contains(el: FakeElement | null): boolean {
    for (let p = el; p; p = p.parentElement) if (p === this) return true;
    return false;
  }
  /** One compound selector: tag, classes and [attr] presence, e.g. "select[data-bank-sort]" */
  matches(selector: string): boolean {
    const m = selector.match(/^([a-z-]+)?((?:\.[\w-]+)*)((?:\[[\w-]+\])*)$/)!;
    return (!m[1] || this.tagName === m[1])
      && m[2].split('.').filter(Boolean).every(c => this.classList.contains(c))
      && [...m[3].matchAll(/\[([\w-]+)\]/g)].every(a => this.attrs.has(a[1]));
  }
  closest(selector: string): FakeElement | null {
    for (let p: FakeElement | null = this; p; p = p.parentElement) if (p.matches(selector)) return p;
    return null;
  }
  querySelectorAll(selector: string): FakeElement[] {
    return this.children.flatMap(c => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]);
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  addEventListener(type: string, fn: (e: FakeEvent) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  dispatchEvent(event: FakeEvent) {
    event.target ??= this;
    for (let p: FakeElement | null = this; p; p = event.bubbles ? p.parentElement : null) for (const fn of p.listeners.get(event.type) ?? []) fn(event);
    return true;
  }
}

/** Runs the component scripts with the fake globals; returns the registry */
function loadComponents() {
  const registry = new Map<string, new () => FakeElement>();
  const customElements = {
    get: (name: string) => registry.get(name),
    define: (name: string, ctor: new () => FakeElement) => {
      if (registry.has(name)) throw new Error(`${name} already defined`);
      registry.set(name, ctor);
    },
  };
  const run = (file: (typeof COMPONENT_SCRIPTS)[number]) => new Function('HTMLElement', 'Element', 'customElements', 'CustomEvent', readScript(file).toString())(FakeElement, FakeElement, customElements, FakeEvent);
  for (const file of COMPONENT_SCRIPTS) {
    run(file);
    run(file); // a script loaded twice must not redefine (or throw)
  }
  return registry;
}

type Spec = [string, Record<string, string>?, Spec[]?];
/** Builds a fake tree; custom elements are created from the registry, then "connected" (as an upgrade does) */
function build(registry: Map<string, new () => FakeElement>, [tag, attrs = {}, kids = []]: Spec): FakeElement {
  const Ctor = registry.get(tag);
  const el = Ctor ? new Ctor() : new FakeElement();
  el.tagName = tag;
  for (const [k, v] of Object.entries(attrs)) el.attrs.set(k, v);
  el.append(...kids.map(k => build(registry, k)));
  return el;
}
const connectAll = (el: FakeElement) => {
  for (const node of [el, ...el.querySelectorAll('choice-chips'), ...el.querySelectorAll('bank-table'), ...el.querySelectorAll('chart-switch'), ...el.querySelectorAll('line-chart')]) {
    (node as unknown as { connectedCallback?: () => void }).connectedCallback?.();
  }
};
const click = (el: FakeElement) => el.dispatchEvent(new FakeEvent('click', { bubbles: true }));
const chips = (name: string, values: string[]): Spec => ['choice-chips', { name }, [['div', { class: 'chips' }, values.map((v, i) => ['button', { class: i ? 'chip' : 'chip is-active', 'data-value': v, 'aria-pressed': String(!i) }] as Spec)]]];
const state = (group: FakeElement) => group.querySelectorAll('.chip').map(c => `${c.dataset.value}:${c.classList.contains('is-active')}:${c.getAttribute('aria-pressed')}`);

test('choice-chips: a click keeps is-active and aria-pressed in step and sends one bubbling choice-change', () => {
  const registry = loadComponents();
  const root = build(registry, ['div', {}, [chips('platform', ['all', 'iOS', 'Android'])]]);
  connectAll(root);
  connectAll(root); // connected again (moved in the page): still one listener
  const group = root.querySelector('choice-chips')!;
  const seen: unknown[] = [];
  root.addEventListener('choice-change', e => seen.push(e.detail));
  click(group.querySelectorAll('.chip')[2]);
  assert.deepEqual(state(group), ['all:false:false', 'iOS:false:false', 'Android:true:true']);
  assert.deepEqual(seen, [{ name: 'platform', value: 'Android' }], 'bubbled to the parent, once');
  click(group.querySelector('.chips')!);
  assert.equal(seen.length, 1, 'a click between chips changes nothing');
});

test('bank-table: chips filter the rows, the count and empty message follow, and the sort reorders by data value', () => {
  const registry = loadComponents();
  const row = (i: number, ios: string, iosSort: string, rank: string): Spec => ['tr', { 'data-index': String(i), 'data-ios': ios, 'data-ios-sort': iosSort, 'data-rank': rank }];
  const table = build(registry, ['bank-table', {}, [
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

test('bank-table: optional parts may be missing; without a table it does nothing and stays ready to retry', () => {
  const registry = loadComponents();
  const bare = build(registry, ['bank-table', {}, [chips('kind', ['all', 'other']), ['tbody', {}, [['tr', { 'data-index': '0', 'data-kind': 'personal' }]]]]]);
  connectAll(bare);
  click(bare.querySelectorAll('.chip')[1]);
  assert.equal(bare.querySelector('tbody')!.rows[0].hidden, true, 'filters without count, empty message or sort');
  const none = build(registry, ['bank-table', {}, [chips('kind', ['all', 'other'])]]);
  assert.doesNotThrow(() => { connectAll(none); click(none.querySelectorAll('.chip')[1]); });
});

test('news-list: filters rows, exposes a stable empty state and expands the unfiltered list', () => {
  const registry = loadComponents();
  const news = build(registry, ['news-list', { 'filter-name': 'news' }, [
    chips('news', ['all', 'Android', 'important', 'missing']),
    ['ul', { 'data-news-items': '' }, [
      ['li', { 'data-platform': 'iOS', 'data-important': '1' }],
      ['li', { 'data-platform': 'Android', 'data-important': '0' }],
      ['li', { 'data-platform': '跨平台', 'data-important': '0' }],
    ]],
    ['button', { 'data-news-more': '' }],
    ['div', { 'data-news-empty': '', hidden: '' }],
  ]]);
  connectAll(news);
  connectAll(news);
  const list = news.querySelector('[data-news-items]')!;
  const more = news.querySelector('[data-news-more]')!;
  const empty = news.querySelector('[data-news-empty]')!;
  const [, android, important, missing] = news.querySelectorAll('.chip');
  assert.equal(list.classList.contains('collapsed'), true);
  assert.equal(more.hidden, false);
  assert.equal(empty.hidden, true);

  click(android);
  assert.deepEqual(list.children.map(row => row.hidden), [true, false, true]);
  assert.equal(list.classList.contains('collapsed'), false, 'a filter shows every match');
  assert.equal(more.hidden, true);
  click(important);
  assert.deepEqual(list.children.map(row => row.hidden), [false, true, true]);
  click(missing);
  assert.deepEqual(list.children.map(row => row.hidden), [true, true, true]);
  assert.equal(empty.hidden, false);

  click(news.querySelectorAll('.chip')[0]);
  click(more);
  assert.equal(more.dataset.expanded, '1');
  assert.equal(more.hidden, true);
  assert.equal(list.classList.contains('collapsed'), false);
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
