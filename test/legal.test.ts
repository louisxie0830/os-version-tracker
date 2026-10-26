import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { SOURCES } from '../src/fetch-all.ts';
import { SOURCE_REGISTER, sourcesMarkdown } from '../src/source-registry.ts';
import { LEGAL_PAGES, markdownToHtml, renderLegalPage } from '../src/legal-pages.ts';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const zh = read('DISCLAIMER.md');
const en = read('DISCLAIMER.en.md');
const labels = Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, v.label])) as Parameters<typeof sourcesMarkdown>[0];

test('SOURCES.md is up to date with the register (run npm run sources:doc after changing src/source-registry.ts)', () => {
  assert.equal(read('SOURCES.md'), sourcesMarkdown(labels));
});

test('every fetched source has a register entry, and every endpoint its own terms link', () => {
  assert.deepEqual(Object.keys(SOURCE_REGISTER).sort(), Object.keys(SOURCES).sort());
  for (const [key, r] of Object.entries(SOURCE_REGISTER)) {
    assert.ok(r.endpoints.length && r.licence && r.note, key);
    for (const e of r.endpoints) assert.match(e.terms, /^https:\/\//, `${key}: ${e.url} has a terms link`);
  }
});

// Hosts the fetchers only link to (shown on the page), never request
const LINK_ONLY_HOSTS = new Set(['apps.apple.com', 'github.com', 'docs.flutter.dev', 'nvd.nist.gov', 'reactnative.dev']);

test('every site the fetchers request is in the register (a new upstream must be registered first)', () => {
  const registered = new Set(Object.values(SOURCE_REGISTER).flatMap(r => r.endpoints.map(e => new URL(e.url.replace(/[{}…]/g, 'x')).hostname)));
  const dir = new URL('../src/fetchers/', import.meta.url);
  for (const file of readdirSync(dir).filter(f => f.endsWith('.ts'))) {
    for (const [, host] of readFileSync(new URL(file, dir), 'utf8').matchAll(/https:\/\/([a-zA-Z0-9.-]+)/g)) {
      assert.ok(registered.has(host) || LINK_ONLY_HOSTS.has(host), `${file}: ${host} is not in src/source-registry.ts`);
    }
  }
});

test('both disclaimers name every host the site fetches from', () => {
  const hosts = new Set(Object.values(SOURCE_REGISTER).flatMap(r => r.endpoints.map(e => new URL(e.url.replace(/[{}…]/g, 'x')).hostname)));
  for (const host of hosts) {
    assert.ok(zh.includes(host), `DISCLAIMER.md lists ${host}`);
    assert.ok(en.includes(host), `DISCLAIMER.en.md lists ${host}`);
  }
});

test('the Chinese and English disclaimers stay in step', () => {
  const headings = (md: string) => [...md.matchAll(/^(#{2,3}) (\d+(?:\.\d+)?)\./gm)].map(m => `${m[1]} ${m[2]}`);
  assert.deepEqual(headings(en), headings(zh), 'same numbered sections');
  assert.ok(headings(zh).length >= 8);
  // Same "last updated" date
  const zhDate = zh.match(/最後更新：(\d{4}) 年 (\d{1,2}) 月 (\d{1,2}) 日/)!;
  const enDate = new Date(`${en.match(/Last updated: ([A-Za-z]+ \d{1,2}, \d{4})/)![1]} UTC`);
  assert.deepEqual([Number(zhDate[1]), Number(zhDate[2]), Number(zhDate[3])], [enDate.getUTCFullYear(), enDate.getUTCMonth() + 1, enDate.getUTCDate()]);
  // The same documents and channels are referenced from both
  for (const ref of ['SOURCES.md', 'DATA_LICENSE.md', 'THIRD_PARTY_NOTICES.md', 'LICENSE', 'SECURITY.md', 'security/advisories/new']) {
    assert.ok(zh.includes(ref) && en.includes(ref), ref);
  }
  // Read-first wording, not "using the site means you agree"
  assert.ok(!/即表示你了解並同意/.test(zh) && !/you acknowledge and agree/.test(en));
  // The liability carve-out for intent and gross negligence stays
  assert.match(zh, /故意或重大過失/);
  assert.match(en, /gross negligence/);
});

test('the privacy sections disclose the author names taken from public sources', () => {
  assert.match(zh, /不蒐集網站訪客的個人資料/);
  assert.match(en, /collects no personal data about its visitors/);
  for (const [text, words] of [[zh, ['Stack Overflow', 'GitHub', '90 天', '30 天', '180 天']], [en, ['Stack Overflow', 'GitHub', '90 days', '30 days', '180 days']]] as const) {
    for (const w of words) assert.ok(text.includes(w), w);
  }
});

test('THIRD_PARTY_NOTICES.md lists exactly the runtime packages in package-lock.json', () => {
  const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, { version?: string; dev?: boolean }> };
  const runtime = Object.entries(lock.packages)
    .filter(([p, v]) => p.startsWith('node_modules/') && !v.dev)
    .map(([p, v]) => `${p.replace(/^.*node_modules\//, '')} ${v.version}`)
    .sort();
  const listed = [...read('THIRD_PARTY_NOTICES.md').matchAll(/^\| ([@\w./-]+) \| ([\d.]+) \|/gm)].map(m => `${m[1]} ${m[2]}`).sort();
  assert.deepEqual(listed, runtime);
});

test('markdownToHtml: headings with anchors, nested lists, tables, links between the documents', () => {
  const html = markdownToHtml([
    '# Title',
    '<!-- hidden -->',
    '## 7. 隱私',
    'See [English](DISCLAIMER.en.md), [register](SOURCES.md#x), [license](LICENSE) and <https://example.com/a?b=1&c=2>.',
    '',
    '- **one** `a|b`',
    '  - nested',
    '- two',
    '',
    '| A | B |',
    '| --- | --- |',
    '| x \\| y | <https://e.com> |',
  ].join('\n'), 'legal/index.html');
  assert.ok(!html.includes('hidden'));
  assert.match(html, /<h2 id="7-隱私">7\. 隱私<\/h2>/);
  // Links between the documents resolve to their published pages
  const resolve = (label: string) => new URL(html.match(new RegExp(`<a href="([^"]+)">${label}</a>`))![1], 'https://site.example/x/legal/').href;
  assert.equal(resolve('English'), 'https://site.example/x/legal/en/');
  assert.equal(resolve('register'), 'https://site.example/x/legal/sources/#x');
  assert.match(html, /<a href="https:\/\/github\.com\/louisxie0830\/os-version-tracker\/blob\/master\/LICENSE">license<\/a>/);
  assert.match(html, /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2">/);
  assert.match(html, /<ul><li><strong>one<\/strong> <code>a\|b<\/code><ul><li>nested<\/li><\/ul><\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<td>x \| y<\/td><td><a href="https:\/\/e\.com">/);
});

test('every legal page renders with the site CSP, stylesheet and links back', () => {
  for (const page of LEGAL_PAGES) {
    const html = renderLegalPage(page, read(page.source));
    assert.match(html, /<meta http-equiv="Content-Security-Policy"/, page.path);
    assert.ok(!/<style\b|\sstyle="|<script>/.test(html), `${page.path}: no inline styles or scripts`);
    assert.match(html, /<link rel="stylesheet" href="(?:\.\.\/)+style\.css\?v=/, page.path);
    assert.match(html, /<a href="(?:\.\.\/)+">← OS Version Tracker<\/a>/, page.path);
  }
});

test('markdownToHtml: bold wrapping a code span pairs up across it; code stays unformatted', () => {
  const html = markdownToHtml('**Do not use `api.json` for alerts** and `a**b**c` stays code.');
  assert.match(html, /<strong>Do not use <code>api\.json<\/code> for alerts<\/strong>/);
  assert.match(html, /<code>a\*\*b\*\*c<\/code>/);
  assert.doesNotMatch(html.replace(/<code>[^<]*<\/code>/g, ''), /\*\*/, 'no stray ** left in the text');
});

test('the disclaimers render with no raw ** left', () => {
  for (const page of LEGAL_PAGES) {
    const html = renderLegalPage(page, readFileSync(new URL(`../${page.source}`, import.meta.url), 'utf8'));
    assert.doesNotMatch(html.replace(/<code>[\s\S]*?<\/code>/g, '').replace(/<pre>[\s\S]*?<\/pre>/g, ''), /\*\*/, page.path);
  }
});

test('the not-found and offline pages link to the site from its own path, whatever address they are served at', async () => {
  const { renderStatusPage } = await import('../src/legal-pages.ts');
  for (const kind of ['not-found', 'offline'] as const) {
    const html = renderStatusPage(kind, '/os-version-tracker/');
    assert.match(html, /<link rel="stylesheet" href="\/os-version-tracker\/style\.css\?v=/);
    assert.match(html, /<a href="\/os-version-tracker\/">← 回到 OS Version Tracker 首頁<\/a>/);
    assert.match(html, /<meta http-equiv="Content-Security-Policy"/);
  }
  assert.match(renderStatusPage('not-found', '/'), /找不到這個頁面/);
  assert.match(renderStatusPage('offline', '/'), /目前離線/);
});
