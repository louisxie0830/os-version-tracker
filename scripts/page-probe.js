// Page check probe (see src/check-page.ts). Injected at the top of <head> in a copy of index.html without
// the CSP; reports through the parent page's title as "PAGE:<json>". ?theme=light|dark picks the theme.
(function () {
  const errors = [];
  addEventListener('error', e => errors.push(e.message || `failed to load ${e.target?.src || e.target?.href || 'a resource'}`), true);
  addEventListener('unhandledrejection', e => errors.push(`unhandled rejection: ${e.reason}`));
  const consoleError = console.error;
  console.error = (...args) => { errors.push(`console.error: ${args.join(' ')}`); consoleError.apply(console, args); };
  const theme = new URLSearchParams(location.search).get('theme');
  if (theme) document.documentElement.dataset.theme = theme;

  const issues = {};
  const add = (kind, detail) => { (issues[kind] ??= []).push(detail); };
  const describe = el => {
    if (!el) return '(nothing)';
    const section = el.closest('section, aside, header, footer');
    const where = section ? section.id || (section.getAttribute('class') || '').split(' ')[0] || section.tagName.toLowerCase() : '?';
    const cls = (el.getAttribute('class') || '').split(' ')[0];
    const text = (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    return `${where} > ${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}${text ? ` "${text}"` : ''}`;
  };
  const visible = el => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !el.closest('[hidden]')
      // Inside a closed <details>, only its own summary shows (not one of a <details> nested in it)
      && !(el.closest('summary') ? el.closest('summary').parentElement.parentElement?.closest('details:not([open])') : el.closest('details:not([open])'));
  };
  const instant = top => scrollTo({ top, behavior: 'instant' });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  function structure() {
    const ids = new Map();
    for (const el of document.querySelectorAll('[id]')) ids.set(el.id, (ids.get(el.id) || 0) + 1);
    for (const [id, n] of ids) if (n > 1) add('duplicate id', `${id} ×${n}`);
    for (const a of document.querySelectorAll('a[href^="#"]')) {
      const id = decodeURIComponent(a.getAttribute('href').slice(1));
      // A hidden link (the section list hides links to sections not on the page) can't be followed
      if (id && !document.getElementById(id) && !a.closest('[hidden]')) add('link to a missing anchor', `${describe(a)} → #${id}`);
    }
    for (const el of document.querySelectorAll('[aria-controls], [aria-labelledby], [aria-describedby], label[for]')) {
      for (const attr of ['aria-controls', 'aria-labelledby', 'aria-describedby', 'for']) {
        for (const id of (el.getAttribute(attr) || '').split(/\s+/).filter(Boolean)) {
          if (!document.getElementById(id)) add('reference to a missing id', `${describe(el)} ${attr}="${id}"`);
        }
      }
    }
    for (const el of document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, summary')) {
      const name = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.getAttribute('placeholder') || el.labels?.[0]?.textContent || '';
      if (!name.trim()) add('control without a name', `${describe(el)} ${el.outerHTML.slice(0, 80)}`);
    }
    for (const a of document.querySelectorAll('a[href]')) {
      if (/^\s*(javascript:|$)/i.test(a.getAttribute('href'))) add('empty or script link', describe(a));
      if (a.target === '_blank' && !/noopener/.test(a.rel)) add('new-tab link without noopener', describe(a));
    }
    for (const img of document.querySelectorAll('img:not([alt])')) add('image without alt', img.getAttribute('src'));
    for (const b of document.querySelectorAll('button:not([type])')) add('button without type', describe(b));
  }

  // A click at the centre of every visible control must land on that control
  function covered() {
    for (const el of document.querySelectorAll('a[href], button, input, select, summary, label')) {
      if (!visible(el) || el.classList.contains('skip-link')) continue;
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      if (r.right < 0 || r.left > innerWidth) continue; // scrolled away inside a horizontal scroller
      const hit = document.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 2), Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 2));
      if (!hit || hit === el || el.contains(hit) || (hit.contains(el) && hit.tagName !== 'A')) continue;
      add('control covered by another element', `${describe(el)}  ←  ${describe(hit)}`);
    }
    instant(0);
  }

  // Sampled across the page: a link may only catch clicks inside its own row or card
  function strayClicks() {
    const height = document.documentElement.scrollHeight;
    const y = innerHeight / 2;
    for (let top = 0; top < height; top += 41) {
      instant(top);
      for (let x = 3; x < innerWidth; x += 47) {
        const a = document.elementFromPoint(x, y)?.closest('a');
        if (!a) continue;
        const box = (a.closest('li, tr, .privacy-card, .now-card, .action, .tl-item') || a).getBoundingClientRect();
        if (x < box.left - 1 || x > box.right + 1 || y < box.top - 1 || y > box.bottom + 1) add('link catches clicks outside its row', describe(a));
      }
    }
    instant(0);
  }

  // Anything reaching past the right edge, outside an intentional horizontal scroller below <body>
  function overflow(when) {
    const width = document.documentElement.clientWidth;
    const scrolls = el => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (['auto', 'scroll', 'hidden'].includes(getComputedStyle(p).overflowX)) return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > width + 1 && !scrolls(el)) add(`past the right edge${when}`, `${describe(el)} (${Math.round(r.right - width)}px)`);
    }
    if (document.documentElement.scrollWidth > width) add(`page wider than the screen${when}`, `${document.documentElement.scrollWidth}px > ${width}px`);
  }

  // Content cut off by a box that hides its overflow (a table wider than its card, a header pushing a column
  // out): nothing to scroll to, so it's simply gone. A scroller in between (overflow auto/scroll) is fine
  function clipped() {
    for (const el of document.querySelectorAll('main *, .rail *')) {
      if (!visible(el) || el.closest('svg, .sr-only, .chart-plot') || !el.textContent.trim()) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll') break;
        if (ox !== 'hidden' && ox !== 'clip') continue;
        // An ellipsis cut is a choice, not an accident
        if (getComputedStyle(p).textOverflow === 'ellipsis' || getComputedStyle(el).textOverflow === 'ellipsis') break;
        const box = p.getBoundingClientRect();
        const cut = Math.max(r.right - box.right, box.left - r.left);
        if (cut > 2) add('cut off by its box', `${describe(el)} (${Math.round(cut)}px outside ${describe(p)})`);
        break;
      }
    }
  }

  // A table squeezed so hard that its text breaks a character or two per line ("App/le/軟/體"): one piece of
  // text over three lines or more, averaging under four characters a line (separate pieces stacked on purpose,
  // a bank's name over its app's, don't count)
  function squeezedTables() {
    for (const cell of document.querySelectorAll('td, th')) {
      if (!visible(cell) || getComputedStyle(cell).display !== 'table-cell') continue;
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent.trim();
        if (text.length < 3) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const lines = new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top))).size;
        if (lines >= 3 && text.length / lines < 4) {
          add('table column squeezed', `${describe(cell)} "${text.slice(0, 20)}" (${lines} lines)`);
          break;
        }
      }
    }
  }

  // A link to a section (the section list, a copied link, #banks in the address) lands with the section's top
  // just under the sticky header: not thousands of pixels off (lazily laid out sections once did that), and
  // not hidden under the header
  function anchors() {
    const root = document.documentElement;
    const smooth = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto'; // smooth scrolling doesn't advance in this headless run
    const padding = parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
    for (const section of document.querySelectorAll('main > section[id]')) {
      if (!visible(section)) continue;
      location.hash = section.id;
      const top = section.getBoundingClientRect().top;
      const atBottom = innerHeight + scrollY >= root.scrollHeight - 2;
      if (Math.abs(top - padding) > 24 && !(atBottom && top > padding)) add('section link lands off target', `#${section.id} top ${Math.round(top)}px, expected ~${Math.round(padding)}px`);
    }
    history.replaceState(null, '', location.pathname + location.search);
    scrollTo(0, 0);
    root.style.scrollBehavior = smooth;
  }

  // Text inside a card must not touch the card's left or right border (content outside its padded body)
  function flushText() {
    for (const el of document.querySelectorAll('.case *')) {
      if (!visible(el) || el.closest('svg, table') || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
      const card = el.closest('.case');
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const left = r.left + parseFloat(s.paddingLeft) + parseFloat(s.borderLeftWidth) - c.left;
      const right = c.right - (r.right - parseFloat(s.paddingRight) - parseFloat(s.borderRightWidth));
      if (left < 8 || right < 8) add('text touching the card edge', `${describe(el)} (${Math.round(Math.min(left, right))}px)`);
    }
  }

  // WCAG AA text contrast against the nearest opaque background
  function contrast() {
    const rgb = s => s.match(/[\d.]+/g)?.map(Number) ?? null;
    const lum = ([r, g, b]) => {
      const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const background = el => {
      for (let p = el; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        const c = rgb(s.backgroundColor);
        if (c && (c.length < 4 || c[3] > 0.9)) return c;
        if (s.backgroundImage !== 'none') return null; // gradients and images: can't tell
      }
      return [255, 255, 255];
    };
    const seen = new Set();
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('svg') || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) || !visible(el)) continue;
      const s = getComputedStyle(el);
      const color = rgb(s.color);
      const bg = background(el);
      if (!color || !bg) continue;
      // What the eye sees: the text colour's own alpha times every opacity on the way up, blended over the
      // background (an opacity:.8 on muted text is how 300 low-contrast notes slipped through before)
      let alpha = color.length === 4 ? color[3] : 1;
      for (let p = el; p && p !== document.body; p = p.parentElement) alpha *= Number(getComputedStyle(p).opacity);
      if (alpha < 0.1) continue; // hidden on purpose (shown on hover or focus)
      const fg = color.slice(0, 3).map((c, i) => c * alpha + bg[i] * (1 - alpha));
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      const ratio = (hi + 0.05) / (lo + 0.05);
      const size = parseFloat(s.fontSize);
      const need = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700) ? 3 : 4.5;
      const key = `${el.getAttribute('class') || el.tagName} ${ratio.toFixed(2)}`;
      if (ratio < need && !seen.has(key)) {
        seen.add(key);
        add('low text contrast', `${describe(el)} ${ratio.toFixed(2)}:1 (needs ${need}:1)`);
      }
    }
  }

  async function interactions() {
    const tick = () => wait(30);
    const resetChips = () => document.querySelectorAll('[data-filter-group], [data-bank-filter], .news-filters').forEach(g => g.querySelector('.chip')?.click());
    // Every custom element in the page is defined (a standard element always is)
    for (const tag of new Set([...document.querySelectorAll(':not(:defined)')].map(el => el.localName))) add('component not defined', tag);
    for (const chip of document.querySelectorAll('.chip')) {
      if (!visible(chip)) continue;
      chip.click();
      await tick();
      // In a choice-chips radio group the clicked chip is the only active one and the only tab stop, and
      // aria-checked says so
      const group = chip.closest('choice-chips');
      for (const c of group ? group.querySelectorAll('.chip') : []) {
        if (c.classList.contains('is-active') !== (c === chip) || c.getAttribute('aria-checked') !== String(c === chip) || c.tabIndex !== (c === chip ? 0 : -1)) {
          add('chip state out of step', `${describe(chip)}: ${describe(c)}`);
        }
      }
      // A chart toggle shows exactly the chosen chart (and its note) of its group
      const toggle = chip.closest('[data-chart-toggle]');
      const card = toggle?.closest('chart-switch');
      for (const el of card ? card.querySelectorAll(`[data-chart-group="${toggle.dataset.chartToggle}"]`) : []) {
        if (el.hidden !== (el.dataset.value !== chip.dataset.value)) add('chart toggle', `${describe(chip)}: ${describe(el)}`);
      }
    }
    // Pointing at a month of a visible chart shows the crosshair and the tooltip; leaving hides them
    for (const chart of document.querySelectorAll('line-chart')) {
      const hit = chart.querySelector('.chart-hit');
      const tip = chart.querySelector('.chart-tip');
      const cross = chart.querySelector('.chart-cross');
      if (!hit || !tip || !cross || !visible(chart.querySelector('figure'))) continue;
      hit.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      if (tip.hidden || !tip.querySelector('strong')?.textContent || cross.getAttribute('visibility') !== 'visible') add('chart tooltip', `no tooltip on ${describe(chart.querySelector('svg'))}`);
      const svg = chart.querySelector('svg');
      svg.dispatchEvent(new PointerEvent('pointerleave'));
      if (!tip.hidden || cross.getAttribute('visibility') !== 'hidden') add('chart tooltip', `tooltip stays after leaving ${describe(svg)}`);
      // The keyboard: focusing shows the month last shown, End the latest, the arrow keys move along, leaving hides it
      svg.focus();
      svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      const last = tip.querySelector('strong')?.textContent;
      svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      const before = tip.querySelector('strong')?.textContent;
      if (document.activeElement !== svg || tip.hidden || !last || before === last) add('chart keyboard', `arrow keys don't move along ${describe(svg)}`);
      svg.blur();
      if (!tip.hidden) add('chart keyboard', `tooltip stays after focus leaves ${describe(svg)}`);
    }
    resetChips();
    await tick();
    overflow(' (after using every filter)');

    // Feed filters: each choice shows rows or the empty message, and the address keeps it
    for (const group of document.querySelectorAll('[data-filter-group]')) {
      for (const chip of group.querySelectorAll('.chip')) {
        chip.click();
        await tick();
        const kept = new URLSearchParams(location.search).get(`f-${group.dataset.filterGroup}`);
        if (kept !== (chip.dataset.value === 'all' ? null : chip.dataset.value)) add('filter not kept in the address', `${group.dataset.filterGroup}: "${chip.dataset.value}", address says ${kept}`);
        const feed = document.getElementById('feed');
        if (feed && ![...feed.querySelectorAll('[data-feed-item]')].some(visible) && ![...feed.querySelectorAll('.feed-empty')].some(visible)) {
          add('filter leaves a blank list', `feed: "${chip.textContent.trim()}"`);
        }
      }
      group.querySelector('.chip')?.click();
      await tick();
    }
    // Bank filters: the count matches the rows shown
    for (const group of document.querySelectorAll('[data-bank-filter]')) {
      for (const chip of group.querySelectorAll('.chip')) {
        chip.click();
        await tick();
        const rows = [...document.querySelectorAll('#bank-rows tr')].filter(visible).length;
        const count = Number(document.getElementById('bank-count')?.textContent.match(/\d+/)?.[0]);
        if (!rows && !visible(document.getElementById('bank-empty'))) add('filter leaves a blank list', `banks: "${chip.textContent.trim()}"`);
        if (count !== rows) add('bank count differs from the rows shown', `"${chip.textContent.trim()}": says ${count}, shows ${rows}`);
      }
      group.querySelector('.chip')?.click();
      await tick();
    }
    // News filters: a match or the component's empty state is always visible
    for (const chip of document.querySelectorAll('.news-filters .chip')) {
      chip.click();
      await tick();
      const news = chip.closest('news-list');
      if (news && ![...news.querySelectorAll('[data-news-items] > li')].some(visible) && !visible(news.querySelector('[data-news-empty]'))) {
        add('filter leaves a blank list', `news: "${chip.textContent.trim()}"`);
      }
    }
    document.querySelector('.news-filters .chip')?.click();
    await tick();
    const sort = document.getElementById('bank-sort');
    if (sort) {
      for (const option of sort.options) { sort.value = option.value; sort.dispatchEvent(new Event('change')); await tick(); }
      sort.value = sort.options[0]?.value;
      sort.dispatchEvent(new Event('change'));
    }
    // "Show more" lists: the rows past the cap wait until the button is used, then show
    for (const more of document.querySelectorAll('[data-show-more]')) {
      const list = more.closest('activity-filter, news-list')?.querySelector('[data-capped]');
      const extras = [...(list?.querySelectorAll(':scope > .list-extra') ?? [])];
      if (!list || !extras.length) { add('show more', `${describe(more)} without a capped list`); continue; }
      if (!visible(more) || extras.some(visible)) add('show more', `${describe(list)} not capped before "show more"`);
      more.click();
      await tick();
      if (visible(more) || !extras.every(visible)) add('show more', `${describe(list)}: rows still hidden after "show more"`);
    }
    // Every other button in the page body ("show more", copy link, back to top…)
    for (const button of document.querySelectorAll('main button, aside button')) {
      if (!visible(button) || button.classList.contains('chip')) continue;
      button.click();
      await tick();
    }

    // Search (debounced in app.js)
    const search = document.getElementById('search');
    if (search) {
      const type = async q => { search.value = q; search.dispatchEvent(new Event('input')); await wait(250); };
      for (const q of ['iOS', 'Xcode', 'CVE']) {
        await type(q);
        if (![...document.querySelectorAll('main > section')].some(visible)) add('search', `"${q}" hides every section`);
        overflow(` (searching "${q}")`);
      }
      // The summary's count of "now" cards and feed rows is the number shown
      await type('iOS');
      const said = Number(document.querySelector('[data-search-summary]')?.textContent.match(/待處理與動態 (\d+) 筆/)?.[1]);
      const shown = [...document.querySelectorAll('[data-feed-item]')].filter(visible).length;
      if (said !== shown) add('search', `summary says ${said} "now" and feed rows, ${shown} shown`);
      await type('zzqqxxnomatch');
      if (!visible(document.getElementById('search-status'))) add('search', 'no message when nothing matches');
      await type('');
      const hidden = [...document.querySelectorAll('main > section')].filter(s => !visible(s) && s.querySelector('h2')).map(s => s.id);
      if (hidden.length) add('search', `clearing the search leaves sections hidden: ${hidden.join(', ')}`);
    }

    // Notification center: opening moves focus into the panel, Escape closes it and returns focus to the
    // bell; every item is a link or a button (both reachable and usable with the keyboard)
    const bell = document.querySelector('[data-notif-bell]');
    const panel = document.querySelector('[data-notif-panel]');
    if (bell && panel) {
      bell.click();
      await tick();
      if (panel.hidden || !panel.contains(document.activeElement)) add('notification center', 'opening leaves focus outside the panel');
      // All of the open panel on screen (on a narrow screen it once opened mostly off the left edge)
      const box = panel.getBoundingClientRect();
      const width = document.documentElement.clientWidth;
      if (box.left < -1 || box.right > width + 1) add('notification center', `the open panel reaches past the screen (${Math.round(box.left)}–${Math.round(box.right)}px of ${width}px)`);
      // The top bar fits its contents on its first row: brand, theme and bell together
      const brand = document.querySelector('.brand');
      if (brand && Math.abs(brand.getBoundingClientRect().top - bell.getBoundingClientRect().top) > 12) add('top bar', 'the bell wrapped onto a row of its own');
      for (const entry of panel.querySelectorAll('.notif-item > *')) {
        if (!(entry.matches('a[href]') || entry.matches('button'))) add('notification center', `${describe(entry)} is neither a link nor a button`);
      }
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await tick();
      if (!panel.hidden || document.activeElement !== bell) add('notification center', 'Escape does not close the panel back to the bell');
    }
    // The section nav, where it's pinned under the top bar, isn't hidden behind it
    const nav = document.querySelector('.section-nav');
    const topbar = document.querySelector('.topbar');
    if (nav && topbar && getComputedStyle(nav).position === 'sticky') {
      scrollTo(0, document.documentElement.scrollHeight / 3);
      await tick();
      const navTop = nav.getBoundingClientRect().top;
      const barBottom = topbar.getBoundingClientRect().bottom;
      if (navTop < barBottom - 2) add('section nav', `pinned at ${Math.round(navTop)}px, under the top bar (which ends at ${Math.round(barBottom)}px)`);
      scrollTo(0, 0);
    }
    // Theme toggle switches and switches back
    const toggle = document.getElementById('theme-toggle');
    // Only the main page has the toggle (the legal pages follow the saved theme)
    if (!toggle) { if (document.querySelector('.topbar')) add('theme toggle', 'not found'); }
    else {
      const before = document.documentElement.dataset.theme;
      toggle.click();
      await tick();
      if (document.documentElement.dataset.theme === before) add('theme toggle', 'click did not change the theme');
      toggle.click();
      await tick();
    }
    // Section links point at visible sections; a link whose section isn't on the page is hidden
    for (const a of document.querySelectorAll('.section-nav a[href^="#"]')) {
      const section = document.getElementById(a.getAttribute('href').slice(1));
      if (!section) { if (visible(a)) add('section link to a missing section', a.getAttribute('href')); }
      else if (!visible(section)) add('section link to a hidden section', a.getAttribute('href'));
    }
    // The capped lists keep has-js: app.js ran
    if (document.querySelector('[data-capped]') && !document.documentElement.classList.contains('has-js')) add('show more', 'has-js dropped although the components are defined');
  }

  addEventListener('load', () => setTimeout(async () => {
    const report = { width: document.documentElement.clientWidth, issues, errors };
    try {
      structure();
      overflow('');
      covered();
      strayClicks();
      document.querySelectorAll('details').forEach(d => { d.open = true; });
      overflow(' (all sections expanded)');
      covered();
      strayClicks();
      contrast();
      flushText();
      clipped();
      squeezedTables();
      anchors();
      await interactions();
      report.localRefs = [...new Set([...document.querySelectorAll('a[href], link[href], script[src], img[src]')]
        .map(el => el.getAttribute('href') ?? el.getAttribute('src'))
        .filter(ref => !/^(?:[a-z]+:|#|\/\/)/i.test(ref)))];
    } catch (e) {
      report.fatal = String(e?.stack || e);
    }
    for (const kind of Object.keys(issues)) issues[kind] = [...new Set(issues[kind])].slice(0, 15);
    parent.document.title = `PAGE:${JSON.stringify(report)}`;
  }, 600));
})();
