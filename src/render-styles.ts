import { contentVersion } from './asset-versions.js';
import { COMPONENT_TAGS } from './component-tags.js';

/**
 * The page's stylesheet, published as style.css: browsers cache it between visits, and the CSP can forbid
 * inline styles altogether (no <style> block, no style attributes; widths and spacing are classes).
 */

/** .w-0 … .w-100: bar widths in whole percent */
const WIDTHS = Array.from({ length: 101 }, (_, n) => `.w-${n} { width: ${n}%; }`).join('\n');

export const PAGE_CSS = `:root {
  --bg: #f7f6f2;
  --bg-2: #fbfaf7;
  --ink: #1b2a33;
  --muted: #5c6a72;
  --accent: #0a5f8c;
  --accent-2: #0e7d71;
  --accent-deep: #0a5f8c;
  --accent-soft: #eaf2f7;
  --teal-soft: #e6f2ef;
  --panel: #ffffff;
  --line: #e3e0d8;
  --line-soft: #efece5;
  --shadow: 0 1px 2px rgba(27, 42, 51, 0.04), 0 8px 24px rgba(27, 42, 51, 0.06);
  --focus: 0 0 0 3px rgba(10, 95, 140, 0.28);

  --pass: #0b7167;
  --pass-soft: #e2f4ef;
  --warn: #8a4d06;
  --community: #7b61c4;
  --warn-soft: #fff1dc;
  --fail: #a3283f;
  --fail-soft: #fde8ec;

  --surface: #ffffff;
  --ink-2: #3b4a52;
  --line-strong: #d3cfc4;
  --strong: #1b2a33;
  --on-strong: #fbfaf7;
  --strong-hover: #2c3f4a;
  --brand: #1b2a33;
  --snap-bg: #1b2a33;
  --snap-ink: #fbfaf7;
  --snap-label: #b9c6cd;
  --snap-dt: #c9d4da;
  --snap-line: #33444e;
  --topbar-bg: rgba(251, 250, 247, 0.92);
  --new-bg: #f3f8fb;
  --cov: #cfe3ee;
  --current-row: rgba(220, 247, 241, 0.5);
  --tag-security-bg: #fde8ec; --tag-security: #a3283f;
  --tag-crash-bg: #eae6fa; --tag-crash: #4b3f99;
  --tag-deadline-bg: #fff1dc; --tag-deadline: #8a4d06;
  --tag-news-bg: #eaf2f7; --tag-news: #24536f;
  --tag-version-bg: #e6efe9; --tag-version: #2d5f3f;
  --series-1: #2a78d6; --series-2: #eb6834; --series-3: #1baf7a; --series-4: #eda100; --series-other: #8c8a84;
  color-scheme: light;

  --r-lg: 18px;
  --r-md: 14px;
  --r-sm: 10px;
  --topbar-h: 72px;
  --mono: "SF Mono", ui-monospace, Menlo, Consolas, monospace;
}

/* Dark: follows the system unless the reader picked a theme (data-theme, set by theme.js). Screens only: printed,
   the page keeps the light palette (paper is white, and backgrounds don't print) */
@media screen and (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
  --bg: #14191c;
    --bg-2: #1a2125;
    --surface: #1e262b;
    --ink: #e8e6e1;
    --ink-2: #c4c9cc;
    --muted: #9aa6ad;
    --accent: #7cc0e6;
    --accent-2: #5cc9b6;
    --accent-deep: #7cc0e6;
    --accent-soft: #1d3442;
    --teal-soft: #173430;
    --panel: #1e262b;
    --line: #2e383e;
    --line-soft: #263036;
    --line-strong: #3c4850;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 8px 24px rgba(0, 0, 0, 0.25);
    --focus: 0 0 0 3px rgba(124, 192, 230, 0.4);
    --pass: #5cc9b6;
    --pass-soft: #163a35;
    --warn: #e8a95a;
    --community: #b4a2ec;
    --warn-soft: #3a2a14;
    --fail: #f08a9c;
    --fail-soft: #3d1c24;
    --strong: #e8e6e1;
    --on-strong: #14191c;
    --strong-hover: #ffffff;
    --brand: #2c4a5c;
    --snap-bg: #0e1316;
    --snap-ink: #e8e6e1;
    --snap-label: #8f9ca3;
    --snap-dt: #aeb9bf;
    --snap-line: #263036;
    --topbar-bg: rgba(20, 25, 28, 0.9);
    --new-bg: #1b2c37;
    --cov: #24465a;
    --current-row: rgba(92, 201, 182, 0.12);
    --tag-security-bg: #3d1c24; --tag-security: #f5a3b2;
    --tag-crash-bg: #2a2547; --tag-crash: #c0b5f4;
    --tag-deadline-bg: #3a2a14; --tag-deadline: #f0b56b;
    --tag-news-bg: #1d3442; --tag-news: #9cceea;
    --tag-version-bg: #1b3326; --tag-version: #9ad8af;
  --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70; --series-4: #c98500; --series-other: #7f8a90;
    color-scheme: dark;
  }
}
@media screen {
:root[data-theme="dark"] {
  --bg: #14191c;
  --bg-2: #1a2125;
  --surface: #1e262b;
  --ink: #e8e6e1;
  --ink-2: #c4c9cc;
  --muted: #9aa6ad;
  --accent: #7cc0e6;
  --accent-2: #5cc9b6;
  --accent-deep: #7cc0e6;
  --accent-soft: #1d3442;
  --teal-soft: #173430;
  --panel: #1e262b;
  --line: #2e383e;
  --line-soft: #263036;
  --line-strong: #3c4850;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 8px 24px rgba(0, 0, 0, 0.25);
  --focus: 0 0 0 3px rgba(124, 192, 230, 0.4);
  --pass: #5cc9b6;
  --pass-soft: #163a35;
  --warn: #e8a95a;
  --community: #b4a2ec;
  --warn-soft: #3a2a14;
  --fail: #f08a9c;
  --fail-soft: #3d1c24;
  --strong: #e8e6e1;
  --on-strong: #14191c;
  --strong-hover: #ffffff;
  --brand: #2c4a5c;
  --snap-bg: #0e1316;
  --snap-ink: #e8e6e1;
  --snap-label: #8f9ca3;
  --snap-dt: #aeb9bf;
  --snap-line: #263036;
  --topbar-bg: rgba(20, 25, 28, 0.9);
  --new-bg: #1b2c37;
  --cov: #24465a;
  --current-row: rgba(92, 201, 182, 0.12);
  --tag-security-bg: #3d1c24; --tag-security: #f5a3b2;
  --tag-crash-bg: #2a2547; --tag-crash: #c0b5f4;
  --tag-deadline-bg: #3a2a14; --tag-deadline: #f0b56b;
  --tag-news-bg: #1d3442; --tag-news: #9cceea;
  --tag-version-bg: #1b3326; --tag-version: #9ad8af;
  --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70; --series-4: #c98500; --series-other: #7f8a90;
  color-scheme: dark;
}
}

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-padding-top: calc(var(--topbar-h) + 16px); scroll-behavior: smooth; }
body {
  margin: 0;
  min-height: 100vh;
  color: var(--ink);
  /* Latin text in the system UI font (in PingFang a hyphen looks like an en dash: "CVE–2026"); Chinese falls
     back to the CJK fonts after it */
  font: 0.9375rem/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif;
  background: var(--bg);
  overflow-x: hidden;
}
a { color: var(--accent); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.skip-link { position: absolute; left: 12px; top: 12px; z-index: 60; padding: 10px 16px; border-radius: var(--r-sm); background: var(--strong); color: var(--on-strong); translate: 0 calc(-100% - 24px); }
/* Moved out by its own height, so large text never leaves its edge showing */
.skip-link:focus { translate: none; }
/* A solid ring in the accent colour (3:1 against the page in both themes); an outline, unlike a shadow, stays
   visible in forced-colors (high contrast) mode */
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(18px); }
  to { opacity: 1; transform: none; }
}

/* Top bar */
.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--topbar-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--line);
}
.topbar-in { max-width: 1440px; margin: 0 auto; min-height: 72px; padding: 12px 24px; display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; }
.brand { display: flex; align-items: center; gap: 10px; min-width: 0; color: inherit; text-decoration: none; margin-right: auto; }
.brand-mark { width: 34px; height: 34px; flex: none; display: grid; place-items: center; border-radius: 10px; background: var(--brand); }
.brand-mark svg { width: 22px; height: 22px; }
.brand-name { font-size: 1.0625rem; font-weight: 700; letter-spacing: .01em; white-space: nowrap; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.theme-toggle { width: 44px; height: 44px; flex: none; display: grid; place-items: center; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); cursor: pointer; }
.theme-toggle:hover { background: var(--line-soft); }
.theme-toggle svg { width: 20px; height: 20px; }
.theme-toggle .icon-sun { display: none; }
:root[data-theme="dark"] .theme-toggle .icon-sun { display: block; }
:root[data-theme="dark"] .theme-toggle .icon-moon { display: none; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .theme-toggle .icon-sun { display: block; }
  :root:not([data-theme="light"]) .theme-toggle .icon-moon { display: none; }
}
.search { flex: 0 1 420px; min-width: 0; display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--muted); transition: border-color .15s ease, box-shadow .15s ease; }
.search:focus-within { border-color: var(--accent); box-shadow: var(--focus); }
.search svg { width: 18px; height: 18px; flex: none; }
.search input { flex: 1; min-width: 0; border: 0; outline: none; font: inherit; font-size: 0.9375rem; color: var(--ink); background: transparent; }
.search input:focus-visible { box-shadow: none; }
.search input { -webkit-appearance: none; appearance: none; padding: 0; }
.search-kbd { flex: none; min-width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--line); border-radius: 6px; font: 600 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); }
.search:focus-within .search-kbd, .search:has(input:not(:placeholder-shown)) .search-kbd { display: none; }
@media (hover: none) { .search-kbd { display: none; } }
.search input::-webkit-search-decoration, .search input::-webkit-search-results-decoration { -webkit-appearance: none; }

/* Three columns: filters + section links, main, version snapshot */
.layout { max-width: 1440px; margin: 0 auto; padding: 28px 24px 72px; display: grid; grid-template-columns: 220px minmax(0, 1fr) 280px; grid-template-areas: "left main right"; gap: 28px; align-items: start; }
.rail-left { grid-area: left; }
.main { grid-area: main; min-width: 0; }
.rail-right { grid-area: right; }
.rail { position: sticky; top: calc(var(--topbar-h) + 20px); max-height: calc(100vh - var(--topbar-h) - 40px); overflow-y: auto; display: flex; flex-direction: column; gap: 22px; scrollbar-width: thin; }
.rail-group { display: flex; flex-direction: column; gap: 8px; }
.rail-label { font-size: 0.75rem; font-weight: 700; letter-spacing: .08em; color: var(--muted); }
/* Custom-element wrappers add behaviour only: no box of their
   own, so the grid and flex layouts around them lay out the wrapped markup as before */
${COMPONENT_TAGS.join(', ')} { display: contents; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
/* Inside the ring: a chip row scrolls sideways on phones (overflow clips anything drawn outside a chip) */
.chips .chip:focus-visible { outline-offset: -2px; }
.section-nav { display: flex; flex-direction: column; gap: 2px; }
.section-nav .rail-label { margin-bottom: 6px; }
.section-nav a { display: flex; align-items: center; min-height: 36px; padding: 0 12px; border-radius: 8px; font-size: 0.875rem; font-weight: 500; color: var(--ink); text-decoration: none; transition: background .15s ease, color .15s ease; }
.section-nav a:hover { background: var(--line-soft); }
.section-nav a[hidden] { display: none; }
.section-nav a.is-current { background: var(--strong); color: var(--on-strong); }

.page-head { margin-bottom: 18px; }

/* Now cards + feed */
.feed-section { margin-bottom: 28px; }
.feed-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.feed-h { margin: 0 0 10px; font-size: 0.8125rem; font-weight: 700; letter-spacing: .06em; color: var(--muted); }
.feed-count { font-size: 0.78125rem; color: var(--muted); }
.now-list { display: grid; gap: 10px; }
.now-card { position: relative; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); padding: 16px 20px 16px 26px; display: grid; gap: 6px; transition: border-color .15s ease, box-shadow .15s ease; }
.now-card::before { content: ""; position: absolute; left: 10px; top: 16px; bottom: 16px; width: 5px; border-radius: 3px; background: var(--warn); }
.now-card.now-security::before { background: #c23a52; }
.now-card.now-crash::before { background: #6a5cc7; }
.now-card:hover { border-color: var(--line-strong); box-shadow: var(--shadow); }
.now-card[hidden] { display: none; }
.now-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 0.75rem; color: var(--muted); }
.now-platform { font-weight: 600; }
.now-card .feed-link { font-size: 1rem; font-weight: 700; line-height: 1.5; color: var(--ink); text-decoration: none; overflow-wrap: anywhere; }
.now-card .feed-link::after { content: ""; position: absolute; inset: 0; border-radius: inherit; }
.now-card p { margin: 0; font-size: 0.875rem; color: var(--ink-2); overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; }
.type-tag { display: inline-flex; align-items: center; min-height: 22px; padding: 0 9px; border-radius: 11px; font-size: 0.75rem; font-weight: 700; white-space: nowrap; }
.type-security { background: var(--tag-security-bg); color: var(--tag-security); }
.type-crash { background: var(--tag-crash-bg); color: var(--tag-crash); }
.type-deadline { background: var(--tag-deadline-bg); color: var(--tag-deadline); }
.type-news { background: var(--tag-news-bg); color: var(--tag-news); }
.type-version { background: var(--tag-version-bg); color: var(--tag-version); }
.type-bank { background: var(--tag-news-bg); color: var(--tag-news); }
.feed-box { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); overflow: hidden; }
.feed-list { list-style: none; margin: 0; padding: 0; }
.feed-row { display: grid; grid-template-columns: 52px minmax(0, 1fr) auto; gap: 14px; align-items: center; padding: 12px 20px; border-bottom: 1px solid var(--line-soft); }
.feed-row[hidden] { display: none; }
.feed-date { font-family: var(--mono); font-size: 0.78125rem; color: var(--muted); }
.feed-title { font-size: 0.90625rem; line-height: 1.5; color: var(--ink); text-decoration: none; overflow-wrap: anywhere; }
.feed-title:hover { color: var(--accent); text-decoration: underline; }
.feed-tags { display: flex; gap: 6px; align-items: center; }
/* Title, plus its author when the title is someone's own writing (GitHub issues) */
.feed-main { min-width: 0; display: grid; gap: 2px; }
.feed-author { font-size: 0.75rem; color: var(--muted); }
.feed-more { display: block; width: 100%; min-height: 48px; font: inherit; font-size: 0.875rem; font-weight: 600; color: var(--accent); background: var(--bg-2); border: 0; cursor: pointer; }
.feed-more:hover { background: var(--line-soft); }
/* Full-width buttons flush with a clipping box: the ring goes inside them */
.feed-more:focus-visible, .news-show-more:focus-visible { outline-offset: -3px; }
.feed-more[hidden], .feed-empty[hidden] { display: none; }
.feed-empty { margin: 0; padding: 18px 20px; color: var(--muted); font-size: 0.875rem; }
/* The to-do list's empty note looks like the cards it stands in for */
.feed-section#now .feed-empty { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); }
.search-miss { display: none !important; }
/* "Show more" caps (capList in light-element.ts): rows past the cap wait while the list is collapsed, from the
   first paint when script runs (theme.js marks the page has-js); the whole-page search lifts the cap. Without
   script every row shows and the button, which would do nothing, doesn't */
.has-js body:not(.searching) .is-collapsed > .list-extra { display: none; }
html:not(.has-js) [data-show-more], .searching [data-show-more], [data-show-more][hidden] { display: none; }
.search-status { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; margin: 14px 0 0; padding: 10px 16px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface); font-size: 0.875rem; }
.search-status[hidden] { display: none; }
.stale-note { margin: 14px 0 0; padding: 10px 16px; border: 1px solid var(--line); border-left: 4px solid var(--warn); border-radius: var(--r-sm); background: var(--warn-soft); color: var(--ink); font-size: 0.875rem; line-height: 1.6; }
.stale-note[hidden] { display: none; }
.search-clear { width: auto; min-height: 40px; padding: 0 14px; border-radius: 10px; }

/* Snapshot rail */
.snap { background: var(--snap-bg); color: var(--snap-ink); border: 1px solid var(--snap-line); border-radius: var(--r-md); padding: 18px 20px; display: grid; gap: 10px; }
.snap .rail-label { color: var(--snap-label); }
.snap dl { margin: 0; display: grid; }
.snap dl div { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 10px 0; border-top: 1px solid var(--snap-line); }
.snap dt { font-size: 0.8125rem; color: var(--snap-dt); }
.snap dd { margin: 0; font-family: var(--mono); font-size: 1.0625rem; font-weight: 600; white-space: nowrap; }
.next-deadline, .subscribe-card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); padding: 18px 20px; display: grid; gap: 10px; }
.next-days { font-family: var(--mono); font-size: 2.5rem; font-weight: 600; line-height: 1; color: var(--warn); }
.next-days small { font-family: "PingFang TC", "Noto Sans TC", sans-serif; font-size: 0.9375rem; font-weight: 600; margin-left: 6px; }
.next-title { font-size: 0.875rem; line-height: 1.6; overflow-wrap: anywhere; }
.next-deadline a { font-size: 0.84375rem; font-weight: 600; text-decoration: none; }
.subscribe-card p { margin: 0; font-size: 0.84375rem; color: var(--muted); }
.subscribe-card .btn { text-align: center; }
.subscribe-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.rail-foot { font-size: 0.75rem; color: var(--muted); }

.btn {
  font-weight: 600;
  font-size: 0.875rem;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--accent-deep);
  padding: 8px 16px;
  border-radius: 999px;
  text-decoration: none;
  white-space: nowrap;
  transition: background .18s ease, border-color .18s ease, transform .18s ease, box-shadow .18s ease;
}
.btn { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; border-radius: 12px; color: var(--ink); }
.btn:hover { background: var(--line-soft); }
.btn.primary { background: var(--strong); border-color: var(--strong); color: var(--on-strong); }
.btn.primary:hover { background: var(--strong-hover); border-color: var(--strong-hover); }

/* Layout */
.intro { margin: 0; color: var(--muted); font-size: 0.875rem; }
/* No one-character last line ("頁。") in the longer texts */
.intro, .tl-body, .next-title, .now-card p, .action-detail { text-wrap: pretty; }

.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  padding: 24px 26px;
  margin-bottom: 20px;
}
.panel > h2, .subhead {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.1875rem;
  margin: 0 0 16px;
  font-weight: 700;
  letter-spacing: .01em;
}
.copy-link { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; margin: -6px 0; padding: 0; border: 0; border-radius: 8px; background: none; color: var(--muted); cursor: pointer; }
.copy-link svg { width: 16px; height: 16px; }
.feed-h { display: flex; align-items: center; gap: 4px; }
.feed-h .copy-link { width: 28px; height: 28px; }
@media (hover: hover) {
  .copy-link { opacity: 0; transition: opacity .12s ease; }
  h2:hover .copy-link, .copy-link:focus-visible { opacity: 1; }
  .copy-link:hover { color: var(--accent); background: var(--line-soft); }
}
.subhead { font-size: 0.8125rem; color: var(--muted); margin: 26px 0 12px; flex-wrap: wrap; row-gap: 2px; }
.subhead-note { flex-basis: auto; }

/* Version cards */
.version-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 14px; }
.version-card {
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: 18px 20px;
  background: var(--bg-2);
}
.version-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.version-number { font-size: 1.375rem; font-weight: 700; letter-spacing: -0.01em; }
.version-details { display: flex; flex-wrap: wrap; gap: 6px; }
.meta {
  font-size: 0.78125rem;
  color: var(--muted);
  background: var(--surface);
  border: 1px solid var(--line);
  padding: 1px 10px;
  border-radius: 999px;
}
code { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 0.75rem; }
.badge {
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid transparent;
  /* A badge is one unit: it never wraps or shrinks inside a flex row */
  white-space: nowrap;
  flex: none;
}
.badge-deprecated { color: var(--fail); background: var(--fail-soft); }
.badge-stable { color: var(--pass); background: var(--pass-soft); border-color: rgba(18, 179, 164, 0.45); }
.badge-beta { color: var(--warn); background: var(--warn-soft); border-color: rgba(180, 105, 14, 0.3); }
.badge-sm { font-size: 0.625rem; padding: 0 7px; }
.empty { color: var(--muted); font-size: 0.875rem; padding: 8px 2px; }

/* Case card (checklist + deadlines) */
.case {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  overflow: hidden;
}
.case-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 20px;
  background: var(--bg-2);
  border-bottom: 1px solid var(--line);
}
.case-no {
  background: var(--surface);
  color: var(--accent-deep);
  font-weight: 700;
  font-size: 0.8125rem;
  padding: 4px 14px;
  border-radius: 999px;
  border: 1px solid var(--line);
  /* A long title (large text, a narrow card) wraps rather than being cut off by the card */
  white-space: normal;
  max-width: 100%;
}
.case-count { font-size: 0.78125rem; color: var(--muted); margin-left: auto; }
.case-body { padding: 18px 20px; }

/* Action checklist */
.actions { list-style: none; margin: 0; padding: 0; }
.action { display: flex; gap: 14px; align-items: flex-start; padding: 14px 20px; }
.action + .action { border-top: 1px solid var(--line-soft); }
.status {
  flex: none;
  min-width: 7.4rem;
  text-align: center;
  font-size: 0.71875rem;
  font-weight: 700;
  letter-spacing: .04em;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid transparent;
  white-space: nowrap;
  margin-top: 1px;
}
.status-urgent { color: var(--fail); background: var(--fail-soft); border-color: rgba(207, 63, 88, 0.32); }
.status-upcoming { color: var(--warn); background: var(--warn-soft); border-color: rgba(180, 105, 14, 0.3); }
.status-ok { color: var(--pass); background: var(--pass-soft); border-color: rgba(18, 179, 164, 0.45); }
.status-info { color: var(--accent-deep); background: var(--accent-soft); border-color: var(--line); }
.action-body { min-width: 0; overflow-wrap: anywhere; }
.action-title { font-size: 0.90625rem; font-weight: 700; line-height: 1.5; }
.action-title a { color: inherit; text-decoration: none; border-bottom: 1px dashed var(--line); }
.action-title a:hover { color: var(--accent-deep); border-bottom-style: solid; }
.action-detail { font-size: 0.8125rem; color: var(--muted); margin-top: 2px; }

/* Toolchain tiles */
.tile-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr)); gap: 12px; }
.tile {
  display: block;
  color: inherit;
  text-decoration: none;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  padding: 12px 16px;
  transition: border-color .18s ease, box-shadow .18s ease, transform .18s ease;
}
a.tile:hover { border-color: var(--line); box-shadow: 0 10px 24px rgba(27, 42, 51, 0.08); transform: translateY(-1px); }
.tile-label { display: flex; align-items: center; gap: 6px; font-size: 0.78125rem; color: var(--muted); font-weight: 500; }
.tile-value { font-size: 1.0625rem; font-weight: 700; margin: 2px 0 4px; color: var(--accent-deep); }
.tile-sub { font-size: 0.75rem; color: var(--muted); line-height: 1.55; }

/* News */
.news { list-style: none; margin: 0; padding: 0; }
.news li { display: flex; align-items: baseline; gap: 10px; padding: 10px 20px; font-size: 0.875rem; }
.news li + li { border-top: 1px solid var(--line-soft); }
.news a { color: var(--ink); text-decoration: none; min-width: 0; overflow-wrap: anywhere; }
.news a:hover { color: var(--accent-deep); text-decoration: underline; }
.news-date { flex: none; font-size: 0.78125rem; color: var(--muted); font-variant-numeric: tabular-nums; }
.news-flag { min-width: 0; padding: 0 8px; font-size: 0.6875rem; }
a.case-count { text-decoration: none; color: var(--accent-deep); font-weight: 600; }
a.case-count:hover { text-decoration: underline; }

/* Adoption */
.subhead-note { font-weight: 500; font-size: 0.75rem; letter-spacing: 0; color: var(--muted); }
.adoption { display: grid; gap: 10px; }
.adoption-row { display: grid; grid-template-columns: 9em 1fr; gap: 12px; align-items: center; }
.adoption-label { font-size: 0.8125rem; color: var(--muted); }
.adoption-bar { display: flex; height: 28px; border-radius: 999px; overflow: hidden; background: var(--accent-soft); }
.seg { display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; }
.seg + .seg { border-left: 2px solid var(--surface); }
/* Widths are whole percents: the last segment takes up the rounding difference */
.seg:last-child { flex-grow: 1; }
.seg.c0, .bar-legend .c0 { background: #0a6ea1; }
.seg.c1, .bar-legend .c1 { background: #12b3a4; color: #1b2a33; }
.seg.c2, .bar-legend .c2 { background: #7cc7e8; color: #1b2a33; }
.seg.c3, .bar-legend .c3 { background: #b9e6de; color: #1b2a33; }
.seg.c-rest, .bar-legend .c-rest { background: #d5e2ea; color: #1b2a33; }
.bar-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; font-size: 0.78125rem; color: var(--muted); }
.bar-legend span { display: inline-flex; align-items: center; gap: 6px; }
.bar-legend i { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }

/* Sources */
.sources { margin-top: 18px; font-size: 0.78125rem; color: var(--muted); }
.sources summary { cursor: pointer; width: fit-content; list-style: none; }
.sources summary::-webkit-details-marker { display: none; }
.sources summary::before { content: "ⓘ "; }
.sources summary:hover { color: var(--accent-deep); }
.sources ul { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.sources li { background: var(--bg); border: 1px solid var(--line-soft); border-radius: 999px; padding: 2px 12px; }
.sources a { color: var(--accent-deep); text-decoration: none; }
.sources a:hover { text-decoration: underline; }
.src-time { margin-left: 6px; font-variant-numeric: tabular-nums; }
.src-fail { margin-left: 6px; color: var(--fail); font-weight: 600; }
.src-stale { margin-left: 6px; color: var(--warn); font-weight: 600; }

/* Compatibility tables */
.table-note { font-size: 0.8125rem; color: var(--muted); margin: -4px 0 10px; }
.case-body > .table-note:only-child { margin: 0; }
.table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface); }
.compat-table { width: 100%; border-collapse: collapse; font-size: 0.84375rem; white-space: nowrap; }
.compat-table th {
  text-align: left;
  font-weight: 700;
  font-size: 0.78125rem;
  color: var(--accent-deep);
  background: var(--bg-2);
  padding: 10px 14px;
}
.compat-table td:not(:first-child) { white-space: normal; }
/* A long header in a narrow card ("release notes 標示") wraps instead of being cut off */
.compat-table th.th-wrap { white-space: normal; }
/* A long bank or app name wraps instead of pushing the table's other columns out of view */
.bank-table td:first-child { white-space: normal; min-width: 9em; }
.compat-table td { padding: 9px 14px; border-top: 1px solid var(--line-soft); }
.compat-table tr.current td { background: var(--current-row); }
.compat-table tbody tr:hover td { background: var(--bg); }
.warn-text { color: var(--warn); font-weight: 600; }

/* Timeline */
.timeline { list-style: none; margin: 0; padding: 0; }
.tl-item { display: flex; gap: 16px; padding: 14px 20px; }
.tl-item + .tl-item { border-top: 1px solid var(--line-soft); }
.tl-date { flex: none; width: 6.5em; font-weight: 700; color: var(--accent-deep); font-variant-numeric: tabular-nums; }
.tl-body { min-width: 0; overflow-wrap: break-word; }
/* The rest of a long detail, and the requirements already in effect, behind a summary line */
.tl-more { margin-top: 4px; }
.tl-more[open] { padding: 8px 12px; margin-top: 6px; border-left: 2px solid var(--line-strong); background: var(--bg-2); border-radius: 0 6px 6px 0; }
.tl-more[open] > summary { margin-bottom: 6px; }
/* What already took effect reads as history, quieter than what's ahead */
.tl-past[open] .tl-item { background: var(--bg-2); }
.tl-more > summary, .tl-past > summary { cursor: pointer; color: var(--accent-deep); font-weight: 600; font-size: 0.8125rem; }
.tl-past { margin: 0; border-top: 1px solid var(--line); }
.tl-past > summary { padding: 12px 20px; }
.tl-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.tl-head .status { min-width: 0; }
/* A long state ("可能已遭利用：CVE-2026-86950") wraps inside its pill rather than widening the card (large text) */
.tl-head .status { max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
.tl-title { font-weight: 700; font-size: 0.90625rem; color: var(--ink); text-decoration: none; flex-basis: 100%; min-width: 0; overflow-wrap: anywhere; }
.tl-title:hover { color: var(--accent-deep); text-decoration: underline; }
.tl-platform { font-size: 0.6875rem; font-weight: 700; padding: 1px 8px; border-radius: 6px; color: #fff; white-space: nowrap; }
.tl-ios { background: #4a5d6b; }
.tl-android { background: #2d7a4f; }
.tl-source { font-size: 0.71875rem; color: var(--muted); margin-top: 2px; }

.offline-banner {
  position: fixed;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  z-index: 30;
  padding: 8px 18px;
  border-radius: 999px;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--on-strong);
  background: var(--strong);
  box-shadow: var(--shadow);
  max-width: calc(100vw - 32px);
  text-align: center;
}
.offline-banner[hidden] { display: none; }

/* "New since last visit" */
.is-new { position: relative; background: var(--new-bg); }
.is-new::after {
  content: "新";
  position: absolute;
  top: 10px;
  right: 14px;
  font-size: 0.6875rem;
  font-weight: 700;
  color: #fff;
  background: var(--accent);
  border-radius: 999px;
  padding: 0 8px;
}

/* Subscribe */
.subscribe { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-size: 0.875rem; color: var(--muted); }

/* Mouse: a whole list row is the click target for its title link (the link stretches over the row);
   other links in the row stay clickable above it. Hover tints only on devices that can hover. */
/* Each stretched link is scoped to its own row, so a title class reused elsewhere can't cover the page */
.feed-row, .crash-list > li, .news-feed > li, .tl-item, .action, .privacy-card { position: relative; }
.feed-row a.feed-title::after, .crash-list > li > a.crash-title::after, .news-feed > li > a.news-title::after, .tl-item a.tl-title::after,
.action .action-title a::after, .privacy-card > a.crash-title::after { content: ""; position: absolute; inset: 0; border-radius: inherit; }
.feed-row a:not(.feed-title), .crash-list > li a:not(.crash-title), .news-feed > li a:not(.news-title),
.tl-item a:not(.tl-title), .action a:not(.action-title a), .action-detail a { position: relative; z-index: 1; }
/* The source line (date, author, licence links) sits above the row's stretched link as a whole, so a click
   between its wrapped lines doesn't open the title instead */
.feed-row .tl-source, .crash-list > li .tl-source, .news-feed > li .tl-source, .tl-item .tl-source, .tl-item .tl-more > summary { position: relative; z-index: 1; }
@media (hover: hover) {
  .feed-row, .crash-list > li, .news-feed > li, .tl-item, .action, .privacy-card { transition: background-color .12s ease; }
  .feed-row:hover, .crash-list > li:has(> a.crash-title):hover, .news-feed > li:hover, .tl-item:has(a.tl-title):hover, .action:has(.action-title a):hover, .privacy-card:hover { background: var(--line-soft); }
  .feed-row:hover .feed-title, .crash-list > li:hover .crash-title, .news-feed > li:hover .news-title, .tl-item:hover .tl-title, .privacy-card:hover .crash-title { color: var(--accent); }
  .now-card:hover .feed-link { color: var(--accent); }
}
/* Horizontal scrollers fade at an edge that has more content (classes set by app.js) */
.is-scroll-more-right { -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 40px), transparent); mask-image: linear-gradient(90deg, #000 calc(100% - 40px), transparent); }
.is-scroll-more-left { -webkit-mask-image: linear-gradient(90deg, transparent, #000 40px); mask-image: linear-gradient(90deg, transparent, #000 40px); }
.is-scroll-more-left.is-scroll-more-right { -webkit-mask-image: linear-gradient(90deg, transparent, #000 40px, #000 calc(100% - 40px), transparent); mask-image: linear-gradient(90deg, transparent, #000 40px, #000 calc(100% - 40px), transparent); }

/* Trend charts */
.trend-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(330px, 100%), 1fr)); gap: 16px; align-items: start; }
.trend-card { min-width: 0; }
.trend-card .case-head { justify-content: space-between; }
.chart-toggle .chip { min-height: 34px; font-size: 0.8125rem; }
.chart { margin: 0; }
.chart[hidden], .trend-insight[hidden] { display: none; }
.chart-legend { list-style: none; margin: 0 0 6px; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 0.78125rem; color: var(--muted); }
.chart-legend li { display: inline-flex; align-items: center; gap: 6px; }
.chart-swatch { display: inline-block; width: 16px; border-top: 2px solid var(--series-other); }
.chart-swatch.series-1 { border-color: var(--series-1); }
.chart-swatch.series-2 { border-color: var(--series-2); }
.chart-swatch.series-3 { border-color: var(--series-3); }
.chart-swatch.series-4 { border-color: var(--series-4); }
.chart-swatch.series-other { border-top-style: dashed; }
.chart-plot { position: relative; }
.chart-plot svg { display: block; width: 100%; height: auto; overflow: visible; font-family: inherit; }
.chart-grid { stroke: var(--line-soft); stroke-width: 1; }
.chart-axis { fill: var(--muted); font-size: 0.75rem; }
.chart-line { fill: none; stroke: var(--series-other); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.chart-dot { fill: var(--series-other); stroke: var(--surface); stroke-width: 2; }
.series-1 .chart-line { stroke: var(--series-1); } .series-1 .chart-dot { fill: var(--series-1); }
.series-2 .chart-line { stroke: var(--series-2); } .series-2 .chart-dot { fill: var(--series-2); }
.series-3 .chart-line { stroke: var(--series-3); } .series-3 .chart-dot { fill: var(--series-3); }
.series-4 .chart-line { stroke: var(--series-4); } .series-4 .chart-dot { fill: var(--series-4); }
.series-other .chart-line { stroke-dasharray: 4 3; }
.chart-end { fill: var(--ink-2); font-size: 0.78125rem; }
.chart-hit { fill: transparent; cursor: crosshair; }
.chart-cross { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 2 2; }
.chart-tip { position: absolute; top: 8px; z-index: 3; min-width: 150px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); box-shadow: var(--shadow); font-size: 0.78125rem; pointer-events: none; }
.chart-tip[hidden] { display: none; }
.chart-tip strong { display: block; margin-bottom: 4px; }
.chart-tip div { display: flex; align-items: center; gap: 6px; }
.chart-tip span:last-child { margin-left: auto; padding-left: 12px; font-variant-numeric: tabular-nums; }
.chart-table { margin-top: 8px; font-size: 0.8125rem; }
.chart-table summary { cursor: pointer; color: var(--muted); width: fit-content; }
.chart-table .table-wrap { margin-top: 8px; }
.api-code { margin: 0; padding: 12px 16px; overflow-x: auto; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--bg-2); font-family: var(--mono); font-size: 0.78125rem; line-height: 1.6; white-space: pre; }
.trend-insight { margin: 8px 0 0; font-size: 0.8125rem; color: var(--muted); }

/* Crashes */
.crash-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
.forum-links { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; margin-top: 14px; font-size: 0.8125rem; color: var(--muted); }
.forum-links a { color: var(--accent-deep); font-weight: 600; text-decoration: none; }
.forum-links a:hover { text-decoration: underline; }
.crash-list { list-style: none; margin: 0; padding: 0; }
.crash-list li { padding: 12px 18px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; overflow-wrap: anywhere; }
.crash-list li + li { border-top: 1px solid var(--line-soft); }
.crash-list .status { min-width: 0; }
.crash-context { font-size: 0.75rem; color: var(--muted); }
.crash-title { font-size: 0.84375rem; font-weight: 600; color: var(--ink); text-decoration: none; line-height: 1.5; }
.crash-title:hover { color: var(--accent-deep); text-decoration: underline; }
.cordova-notes { margin-top: 10px; }
.plugin-advisory { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 2px 0; font-size: 0.8125rem; }
.plugin-advisory .status { min-width: 0; }
.cordova-notes-title { font-size: 0.78125rem; font-weight: 600; color: var(--ink); }
.cordova-notes ul { margin: 4px 0 0; padding-left: 18px; font-size: 0.8125rem; line-height: 1.55; overflow-wrap: anywhere; }
.crash-note { font-size: 0.71875rem; color: var(--muted); padding: 10px 18px; border-top: 1px solid var(--line-soft); background: var(--bg); }
.tl-cross { background: #5e4fb3; }
.wrap-cell { white-space: normal; min-width: 200px; }
/* Short values that read as one unit ("API 24", "iOS 15 以上", "10 KB") never break inside */
.nowrap { white-space: nowrap; }

/* Privacy */
.privacy-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 12px; }
.privacy-card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-sm); padding: 12px 16px; display: grid; gap: 4px; align-content: start; min-width: 0; overflow-wrap: anywhere; }
.privacy-card code { word-break: break-all; }
.privacy-reasons { display: flex; flex-wrap: wrap; gap: 4px; }
/* A framework's recent breaking changes, by minor line, each linking to its migration guide */
.breaking-minor { font-size: 0.78125rem; font-weight: 700; color: var(--muted); margin-top: 8px; }
.breaking-list { margin: 4px 0 0; padding-left: 18px; font-size: 0.84375rem; line-height: 1.6; }
.breaking-list a { color: var(--accent-deep); overflow-wrap: anywhere; }
/* One API name per chip: a long name breaks inside its chip, never leaving a separator alone on a line */
.privacy-apis { display: flex; flex-wrap: wrap; gap: 4px 6px; margin-top: 2px; }
.privacy-apis code { overflow-wrap: anywhere; background: var(--bg); border: 1px solid var(--line-soft); border-radius: 6px; padding: 0 6px; }
.privacy-reasons { margin-top: 4px; }
.privacy-reasons span { position: relative; z-index: 1; }
.privacy-reasons span { background: var(--accent-soft); border-radius: 6px; padding: 0 6px; cursor: help; align-self: start; }
.sdk-list summary { cursor: pointer; font-size: 0.84375rem; color: var(--accent-deep); font-weight: 600; }
.sdk-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.sdk-chips span { font-size: 0.78125rem; background: var(--surface); border: 1px solid var(--line); border-radius: 999px; padding: 1px 10px; }
.privacy-links { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.privacy-links ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.privacy-links li { display: grid; font-size: 0.84375rem; }
.privacy-links li a { color: var(--accent-deep); font-weight: 600; text-decoration: none; }
.privacy-links li a:hover { text-decoration: underline; }
.privacy-links li span { font-size: 0.78125rem; color: var(--muted); }

/* Notification center */
.notif { position: relative; }
.notif-bell {
  position: relative;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;
}
.notif-bell:hover { background: var(--line-soft); }
.notif-bell svg { width: 20px; height: 20px; }
.notif-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 1.25rem;
  min-height: 1.25rem;
  padding: .1em .35em;
  border-radius: 999px;
  background: var(--fail);
  color: var(--surface);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.6875rem;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  border: 2px solid var(--surface);
}
.notif-badge[hidden], .notif-panel[hidden] { display: none; }
.notif-panel {
  position: absolute;
  right: 0;
  top: calc(100% + 10px);
  width: min(400px, calc(100vw - 24px));
  max-height: min(70vh, 560px);
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  box-shadow: var(--shadow);
  overflow: hidden;
  z-index: 40;
}
.notif-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: var(--bg-2); border-bottom: 1px solid var(--line); }
.notif-link { border: 0; background: none; color: var(--accent-deep); font: inherit; font-size: 0.8125rem; font-weight: 600; cursor: pointer; }
.notif-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; }
/* An item: a link, or a button when it has no link (both mark it read) */
.notif-entry { display: grid; gap: 4px; width: 100%; padding: 11px 16px; color: var(--ink); font: inherit; text-align: left; text-decoration: none; background: none; border: 0; border-bottom: 1px solid var(--line-soft); cursor: pointer; }
.notif-entry:hover { background: var(--bg); }
/* Inside the scrolling list: the ring drawn within the item, or the list would clip all but its top edge */
.notif-entry:focus-visible { outline-offset: -3px; }
.notif-item.unread .notif-entry { background: var(--line-soft); }
.notif-panel:focus { outline: none; }
.notif-item.unread .notif-title::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); margin-right: 8px; vertical-align: 2px; }
.notif-meta { display: flex; flex-wrap: wrap; gap: 2px 8px; align-items: center; font-size: 0.75rem; color: var(--muted); }
.notif-meta > span { white-space: nowrap; }
.notif-title { font-size: 0.84375rem; font-weight: 600; line-height: 1.5; overflow-wrap: anywhere; }
.notif-empty { padding: 24px 16px; text-align: center; color: var(--muted); font-size: 0.875rem; }
.notif-foot { display: grid; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--line); font-size: 0.75rem; color: var(--muted); }
.notif-foot .btn { cursor: pointer; font: inherit; font-size: 0.8125rem; font-weight: 600; justify-self: start; }
.notif-foot .btn[hidden] { display: none; }

/* Back to top: bottom right, above the iPhone home indicator; toasts sit above it */
.to-top { position: fixed; right: 20px; bottom: calc(20px + env(safe-area-inset-bottom)); z-index: 45; width: 48px; height: 48px; display: grid; place-items: center; border-radius: 50%; border: 1px solid var(--line); background: var(--surface); color: var(--ink); box-shadow: var(--shadow); cursor: pointer; opacity: 1; transform: none; transition: opacity .2s ease, transform .2s ease, background-color .15s ease; }
.to-top svg { width: 22px; height: 22px; }
.to-top[hidden] { display: grid; opacity: 0; transform: translateY(12px); pointer-events: none; visibility: hidden; }
@media (hover: hover) { .to-top:hover { background: var(--line-soft); } }

/* Toasts */
.toasts { position: fixed; right: 20px; bottom: calc(80px + env(safe-area-inset-bottom)); z-index: 50; display: grid; gap: 10px; width: min(360px, calc(100vw - 32px)); }
.toast {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  box-shadow: var(--shadow);
  font-size: 0.84375rem;
  animation: fadeUp .3s ease both;
}
.toast-body { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.toast-action { flex: none; cursor: pointer; font: inherit; font-size: 0.78125rem; padding: 4px 12px; }
.toast-close { flex: none; border: 0; background: none; font-size: 1.125rem; line-height: 1; color: var(--muted); cursor: pointer; }

/* Version distribution */
.share-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; margin-top: 14px; }
.share-top { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-sm); padding: 12px 16px; display: grid; gap: 8px; }
.share-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.share-chips span { font-size: 0.8125rem; background: var(--bg); border: 1px solid var(--line-soft); border-radius: 999px; padding: 2px 10px; }
.share-chips strong { color: var(--accent-deep); }
.share-top a { color: var(--accent-deep); }
.share-table .compat-table { white-space: normal; }
.share-table th:first-child, .share-table td:first-child { width: 28%; white-space: nowrap; }
/* A long header ("最低支援版本（Deployment Target）") wraps rather than pushing the last column out of view */
.share-table th:first-child { white-space: normal; }
.share-table td:not(:first-child) { width: 36%; }
.cov { position: relative; height: 22px; border-radius: 6px; background: var(--bg); overflow: hidden; }
.cov-bar { position: absolute; inset: 0 auto 0 0; background: var(--cov); border-radius: 6px; }
.cov-num { position: relative; display: block; padding: 0 8px; line-height: 22px; font-size: 0.78125rem; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--ink); }

/* Taiwan banks */
.bank-summary { display: grid; gap: 10px; margin-bottom: 14px; }
.bank-summary .share-chips strong { margin-left: 6px; }
.bank-table a { color: var(--accent-deep); text-decoration: none; font-weight: 600; }
.bank-table a:hover { text-decoration: underline; }
.bank-filters { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; margin-bottom: 14px; }
.bank-filter { display: flex; align-items: center; gap: 10px; min-width: 0; }
.bank-filter .rail-label { flex: none; width: 7.5em; white-space: nowrap; }
.bank-filter .chips { min-width: 0; }
.bank-filter-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; }
.bank-sort { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; font-size: 0.8125rem; color: var(--muted); }
.bank-sort select { min-width: 0; max-width: 100%; }
.bank-sort select { -webkit-appearance: none; appearance: none; min-height: 40px; padding: 0 34px 0 12px; border: 1px solid var(--line); border-radius: 10px; color: var(--ink); font: inherit; font-size: 0.875rem; cursor: pointer;
  background: var(--surface) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%238c8a84' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 12px center / 12px 8px; }
.bank-table tr[hidden] { display: none !important; }
.bank-change { display: inline-block; margin-left: 6px; padding: 0 8px; border-radius: 10px; font-size: 0.75rem; font-weight: 600; white-space: nowrap; }
.bank-change.is-up { background: var(--tag-deadline-bg); color: var(--tag-deadline); }
.bank-change.is-down { background: var(--tag-version-bg); color: var(--tag-version); }
.bank-kind { margin-left: 4px; vertical-align: 1px; color: var(--accent-deep); background: var(--accent-soft); border-color: var(--line); }

/* Legal */
.legal-points { margin: 0 0 10px; padding-left: 1.3em; font-size: 0.84375rem; line-height: 1.75; }
.legal-lead { font-size: 0.8125rem; color: var(--muted); margin: 0 0 8px; }
.legal-links { font-size: 0.84375rem; margin: 0; }
.legal-links a { color: var(--accent-deep); font-weight: 600; }

/* Basis tags + upgrade plan */
.basis { display: inline-block; margin-left: 8px; font-size: 0.6875rem; font-weight: 700; border-radius: 999px; padding: 0 8px; vertical-align: 2px; cursor: help; }
.basis-official { color: var(--muted); border: 1px solid var(--line); }
.basis-estimate { color: var(--warn); border: 1px dashed rgba(180, 105, 14, 0.5); }
.basis-community { color: var(--community); border: 1px dashed rgba(123, 97, 196, 0.5); }
.basis-reference { color: var(--accent-deep); border: 1px dotted var(--line); }
.basis-legend { padding: 8px 20px 10px; font-size: 0.71875rem; color: var(--muted); border-top: 1px solid var(--line-soft); line-height: 2; }
.basis-legend .basis { margin: 0 4px 0 0; }

/* Developer news */
.news-filters { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { font: inherit; font-size: 0.875rem; font-weight: 500; min-height: 38px; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 19px; padding: 0 14px; cursor: pointer; transition: background .15s ease, color .15s ease, border-color .15s ease; }
.chip:hover { background: var(--line-soft); }
.chip.is-active { color: var(--on-strong); background: var(--strong); border-color: var(--strong); }
.news-feed .news-item { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; }
.news-feed .news-item[hidden] { display: none; }
.news-cat { font-size: 0.75rem; color: var(--muted); }
.news-title { flex: 1 1 320px; min-width: 0; color: var(--ink); font-weight: 600; text-decoration: none; overflow-wrap: anywhere; }
a.news-title:hover { color: var(--accent-deep); text-decoration: underline; }
.news-source { font-size: 0.75rem; color: var(--muted); margin-left: auto; }
.news-show-more { display: block; width: 100%; padding: 10px; font: inherit; font-size: 0.8125rem; font-weight: 600; color: var(--accent-deep); background: var(--bg); border: 0; border-top: 1px solid var(--line); cursor: pointer; }
.news-empty { padding: 18px; text-align: center; color: var(--muted); font-size: 0.875rem; }
.news-jump { margin: 14px 0 0; font-size: 0.84375rem; }
.news-jump a { color: var(--accent-deep); font-weight: 600; text-decoration: none; }

/* Deadlines */
.deadline-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); gap: 16px; }
.deadline-date { font-size: 1.0625rem; font-weight: 700; color: var(--accent-deep); }
.deadline-note { font-size: 0.8125rem; color: var(--muted); margin-bottom: 10px; }
.deadline-reqs { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.deadline-reqs li {
  display: flex;
  flex-direction: column;
  font-size: 0.8125rem;
  padding: 8px 12px;
  border-radius: var(--r-sm);
  background: var(--bg);
  border: 1px solid var(--line-soft);
}
.deadline-reqs span { color: var(--muted); font-size: 0.75rem; }
.deadline-reqs strong { overflow-wrap: anywhere; }
.deadline-meta { font-size: 0.78125rem; color: var(--muted); margin-top: 10px; }

@media (max-width: 73.75em) {
  /* One column: snapshot and next deadline first, then filters and content; subscribing goes last */
  .layout { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-areas: none; gap: 14px; padding-top: 18px; }
  .rail-left, .main, .rail-right { grid-area: auto; }
  .rail-left { display: contents; }
  .rail-group, .section-nav, .main, .subscribe-card { grid-column: 1 / -1; }
  .rail-group { order: 3; }
  .rail { position: static; max-height: none; overflow: visible; }
  .rail-right { display: contents; }
  .snap { order: 1; }
  .snap dl { grid-template-columns: repeat(auto-fit, minmax(min(160px, 100%), 1fr)); column-gap: 20px; }
  .next-deadline { order: 2; }
  .section-nav { order: 4; }
  .main { order: 5; margin-top: 8px; }
  .subscribe-card { order: 6; }
  /* Jumps land below both the top bar and the pinned section nav */
  html { scroll-padding-top: calc(var(--topbar-h) + 72px); }
  .rail-left { gap: 14px; }
  .rail-group { flex-direction: row; align-items: center; gap: 10px; }
  .rail-group .rail-label { flex: none; width: 2.5em; }
  .chips { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; }
  .chips::-webkit-scrollbar { display: none; }
  .chip { flex: none; }
  .section-nav { flex-direction: row; overflow-x: auto; gap: 4px; scrollbar-width: none; position: sticky; top: var(--topbar-h); z-index: 10; background: var(--bg); padding: 8px 0; margin: 0 -24px; padding-inline: 24px; border-bottom: 1px solid var(--line); }
  .section-nav::-webkit-scrollbar { display: none; }
  /* Its fade is a gradient over the links, not a mask: a mask would fade the bar's own background too and let
     the page scrolling under it show through */
  .section-nav.is-scroll-more-left, .section-nav.is-scroll-more-right { -webkit-mask-image: none; mask-image: none; }
  .section-nav::before, .section-nav::after { content: ""; position: sticky; z-index: 1; flex: none; width: 40px; pointer-events: none; opacity: 0; transition: opacity .15s ease; }
  .section-nav::before { order: -1; left: 0; margin-right: -40px; background: linear-gradient(90deg, var(--bg), transparent); }
  .section-nav::after { order: 99; right: 0; margin-left: -40px; background: linear-gradient(270deg, var(--bg), transparent); }
  .section-nav.is-scroll-more-left::before, .section-nav.is-scroll-more-right::after { opacity: 1; }
  .section-nav .rail-label { display: none; }
  .section-nav a { flex: none; min-height: 40px; }
  .crash-grid { grid-template-columns: 1fr; }
}
/* Breakpoints are in em (of the browser's default text size): a reader who enlarges text gets the narrower
   layout, as on a smaller screen. Tablets: the search takes its own row, so the bell stays at the top bar's right end with its panel under it
   (wrapped onto the second row's left, the panel opened past the screen's left edge) */
@media (min-width: 47.5625em) and (max-width: 64em) {
  :root { --topbar-h: 128px; }
  .search { order: 3; flex: 1 1 100%; }
}
@media (max-width: 47.5em) {
  :root { --topbar-h: 116px; }
  /* The panel spans the screen under the top bar, whichever row the bell landed on */
  .notif { position: static; }
  .notif-panel { position: fixed; left: 12px; right: 12px; width: auto; top: calc(var(--topbar-h) + 4px); max-height: calc(100vh - var(--topbar-h) - 24px); }
  /* The brand gives way first (its name shortens), so the theme and bell buttons stay on the top row */
  .brand { flex: 1 1 0; }
  .layout { grid-template-columns: minmax(0, 1fr); }
  .topbar-in { padding: 10px 16px; gap: 10px; }
  .brand-name { font-size: 0.9375rem; }
  .topbar-subscribe { display: none; }
  .search { order: 3; flex: 1 1 100%; }
  .search input { font-size: 1rem; }
  .layout { padding: 14px 16px 88px; }
  .section-nav { margin: 0 -16px; padding-inline: 16px; }
  .now-card { padding: 14px 16px 14px 24px; }
  .feed-row { grid-template-columns: 44px minmax(0, 1fr); gap: 4px 10px; padding: 12px 16px; align-items: start; }
  .feed-date { padding-top: 2px; }
  /* Searching on a phone: the result line stays in view at the bottom (in the page it sits under the
     snapshot, a screen below the search box) */

  /* The back-to-top button smaller and the page longer at the end, so it covers less and never the last line */
  .to-top { right: 12px; width: 40px; height: 40px; }
  .feed-tags { grid-column: 2; }
  .panel { padding: 20px 16px; border-radius: var(--r-md); }
  .action { flex-direction: column; gap: 6px; padding: 14px 16px; }
  .status { min-width: 0; }
  .tile-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .tile { overflow-wrap: anywhere; }
  .tile:last-child:nth-child(odd) { grid-column: 1 / -1; }
  .adoption-row { grid-template-columns: 1fr; gap: 4px; }
  .news li { flex-wrap: wrap; padding: 10px 16px; }
  .tl-item { flex-direction: column; gap: 4px; padding: 14px 16px; }
  .crash-grid, .privacy-links, .share-grid { grid-template-columns: minmax(0, 1fr); }
  /* Tables become one card per row, each value labelled, instead of clipping columns */
  .table-wrap { border: 0; background: transparent; overflow: visible; }
  /* Chart data tables aren't stacked into cards: they scroll inside their box instead */
  .chart-table .table-wrap { border: 1px solid var(--line); background: var(--surface); overflow-x: auto; }
  /* The legal documents' tables don't stack into cards: they scroll sideways instead */
  .legal-doc .table-wrap { border: 1px solid var(--line); background: var(--surface); overflow-x: auto; }
  .stack-on-mobile, .stack-on-mobile tbody, .stack-on-mobile tr, .stack-on-mobile td { display: block; width: 100%; }
  .stack-on-mobile thead { display: none; }
  .stack-on-mobile { white-space: normal; }
  .stack-on-mobile tr { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-sm); padding: 10px 14px; margin-bottom: 10px; }
  .stack-on-mobile tr.current { border-color: rgba(18, 179, 164, 0.6); background: var(--current-row); }
  .stack-on-mobile tr.current td, .stack-on-mobile tbody tr:hover td { background: transparent; }
  .stack-on-mobile td { display: flex; gap: 12px; justify-content: space-between; padding: 5px 0; border-top: 1px dashed var(--line-soft); text-align: right; overflow-wrap: anywhere; }
  .stack-on-mobile td::before { content: attr(data-label); flex: none; color: var(--muted); font-size: 0.78125rem; text-align: left; }
  .stack-on-mobile td.row-title { border-top: 0; justify-content: flex-start; text-align: left; font-size: 0.9375rem; padding-top: 0; }
  .stack-on-mobile td.row-title::before { content: none; }
  .stack-on-mobile td.wrap-cell { flex-direction: column; gap: 2px; text-align: left; }
  .wrap-cell { min-width: 0; }
  .table-wrap.share-table { border: 1px solid var(--line); background: var(--surface); overflow-x: auto; }
  .share-table td, .share-table th { padding: 8px 10px; }
  .bank-table .bank-updated { display: none; }
  .bank-table tr { padding: 8px 14px; margin-bottom: 8px; }
  .bank-filter { flex-direction: column; align-items: stretch; gap: 6px; }
  .bank-filter .rail-label { width: auto; }
  .subhead-note { flex-basis: 100%; }
  /* The chart scales down to ~60% here: bigger axis text; the legend, tooltip and table name the lines */
  .chart-axis { font-size: 1.1875rem; }
  .chart-end { display: none; }
  .chart-tick-minor { display: none; }
}
@media (max-width: 26.25em) {
  /* A card title wraps rather than being cut off by the card */
  .case-no { white-space: normal; max-width: 100%; }
  /* The count on a line of its own when the title fills one, the same for every card */
  .case-head > .case-count { flex-basis: 100%; margin-left: 0; }
}
/* Searching on a phone (or a phone held sideways): the result line stays in view at the bottom, one row (in the
   page it sits under the snapshot, a screen below the search box); what else floats there moves above it */
@media (max-width: 47.5em), (max-height: 31.25em) {
  :root { --status-h: 60px; }
  body.searching .search-status:not([hidden]) { position: fixed; left: 12px; right: 12px; bottom: calc(12px + env(safe-area-inset-bottom)); z-index: 44; margin: 0; flex-wrap: nowrap; min-height: var(--status-h); padding: 8px 8px 8px 14px; box-shadow: var(--shadow); }
  body.searching .search-status [data-search-summary] { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  body.searching .search-status .search-clear { flex: none; min-height: 40px; padding: 0 10px; }
  body.searching .to-top, body.searching .offline-banner { bottom: calc(var(--status-h) + 24px + env(safe-area-inset-bottom)); }
  body.searching .toasts { bottom: calc(var(--status-h) + 80px + env(safe-area-inset-bottom)); }
  body.searching .site-foot { padding-bottom: calc(var(--status-h) + 32px); }
}
/* A short window (a phone held sideways, 400% zoom): the bars scroll away instead of covering most of it */
@media (max-height: 31.25em) {
  .topbar, .section-nav { position: static; }
  html { scroll-padding-top: 16px; }
}
/* More contrast asked for: borders as strong as secondary text */
@media (prefers-contrast: more) {
  :root { --line: var(--muted); --line-soft: var(--line-strong); }
}
/* Windows high contrast and other forced colours: states shown by background alone get a system colour back */
@media (forced-colors: active) {
  .chip.is-active, .chip[aria-checked="true"], .section-nav a.is-current { background: Highlight; color: HighlightText; forced-color-adjust: none; }
  .chart-swatch, .seg, .seg > *, .bar-legend i, .cov-bar { forced-color-adjust: none; }
  .now-card { border-left: 4px solid CanvasText; }
  .badge, .status, .tl-platform { border: 1px solid CanvasText; }
  /* The logo is white on its own colour: kept as drawn */
  .brand-mark { forced-color-adjust: none; }
}
/* Print: the content, not the controls; external links show where they go */
@media print {
  .topbar, .rail-left, .section-nav, .chips, choice-chips, .to-top, .toasts, .notif, .copy-link, [data-show-more], .search-status, .skip-link { display: none !important; }
  .layout { display: block; }
  .rail-right { display: none; }
  [data-capped] .list-extra, .is-collapsed .list-extra { display: revert !important; }
  /* …in their own layout: "revert" would make a grid row a block */
  [data-capped] .feed-row.list-extra, .is-collapsed .feed-row.list-extra { display: grid !important; }
  /* Paper has no "more": the whole text */
  .now-card p { display: block; -webkit-line-clamp: unset; line-clamp: none; overflow: visible; }
  .case, .now-card, .tl-item, tr { break-inside: avoid; }
  a[href^="http"]::after { content: " (" attr(href) ")"; font-size: .8em; color: #555; overflow-wrap: anywhere; }
  .feed-row a.feed-title::after, .crash-list > li > a.crash-title::after, .news-feed > li > a.news-title::after, .tl-item a.tl-title::after,
  .action .action-title a::after, .privacy-card > a.crash-title::after { position: static; content: " (" attr(href) ")"; }
  body { background: #fff; color: #000; }
}

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { transition: none !important; animation: none !important; }
}

/* Footer: legal links on every page view */
.site-foot { max-width: 1440px; margin: 0 auto; padding: 8px 24px 40px; font-size: 0.8125rem; color: var(--muted); line-height: 1.9; }
.site-foot a { color: var(--accent-deep); }

/* Legal documents (/legal/) */
.legal-doc { max-width: 900px; margin: 0 auto; padding: 24px 16px 48px; }
.legal-doc-nav { font-size: 0.875rem; color: var(--muted); line-height: 1.8; }
.legal-doc-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.legal-doc-nav a { color: var(--accent-deep); }
.legal-doc-nav a[aria-current="page"] { color: var(--ink); font-weight: 700; text-decoration: none; }
.legal-doc article { line-height: 1.75; overflow-wrap: anywhere; }
/* In tables a word only breaks when nothing else fits (anywhere would squeeze columns to a character or two);
   a table of four or more columns turns into one card per row on a phone (legal-pages.ts) */
.legal-doc article td, .legal-doc article th { overflow-wrap: break-word; }
.legal-doc article h1 { font-size: 1.5rem; margin: 0 0 12px; }
.legal-doc article h2 { font-size: 1.1875rem; margin: 28px 0 10px; }
.legal-doc article h3 { font-size: 1rem; margin: 22px 0 8px; }
.legal-doc article a { color: var(--accent-deep); }
.legal-doc article ul { padding-left: 1.4em; }
.legal-doc article li { margin: 4px 0; }
.legal-doc article code { font-size: .92em; background: var(--line-soft); border-radius: 4px; padding: 0 4px; overflow-wrap: anywhere; }
.legal-doc .table-wrap { margin: 12px 0; }

/* Utilities (instead of style attributes) */
${WIDTHS}
.mt-10 { margin-top: 10px; }
.mt-12 { margin-top: 12px; }
.mt-16 { margin-top: 16px; }
.mt-18 { margin-top: 18px; }
`;

/** Cache-busting query for the stylesheet link */
export const STYLE_VERSION = contentVersion(PAGE_CSS);

/** A whole-percent width class for a share */
export const widthClass = (pct: number) => `w-${pct > 0 ? Math.max(1, Math.min(100, Math.round(pct))) : 0}`;
