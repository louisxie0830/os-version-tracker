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
      && !(el.closest('details:not([open])') && !el.closest('summary'));
  };
  const instant = top => scrollTo({ top, behavior: 'instant' });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  function structure() {
    const ids = new Map();
    for (const el of document.querySelectorAll('[id]')) ids.set(el.id, (ids.get(el.id) || 0) + 1);
    for (const [id, n] of ids) if (n > 1) add('duplicate id', `${id} ×${n}`);
    for (const a of document.querySelectorAll('a[href^="#"]')) {
      const id = decodeURIComponent(a.getAttribute('href').slice(1));
      if (id && !document.getElementById(id)) add('link to a missing anchor', `${describe(a)} → #${id}`);
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
      const fg = rgb(s.color);
      const bg = background(el);
      if (!fg || !bg || (fg.length === 4 && fg[3] < 0.9) || Number(s.opacity) < 1) continue;
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
    // The custom elements in the page (choice-chips.js, bank-table.js, trend-charts.js) are defined
    for (const tag of ['choice-chips', 'bank-table', 'chart-switch', 'line-chart']) {
      if (document.querySelector(tag) && !customElements.get(tag)) add('component not defined', tag);
    }
    for (const chip of document.querySelectorAll('.chip')) {
      if (!visible(chip)) continue;
      chip.click();
      await tick();
      // In a choice-chips group the clicked chip is the only active one, and aria-pressed says so
      const group = chip.closest('choice-chips');
      for (const c of group ? group.querySelectorAll('.chip') : []) {
        if (c.classList.contains('is-active') !== (c === chip) || c.getAttribute('aria-pressed') !== String(c === chip)) {
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
      chart.querySelector('svg').dispatchEvent(new PointerEvent('pointerleave'));
      if (!tip.hidden || cross.getAttribute('visibility') !== 'hidden') add('chart tooltip', `tooltip stays after leaving ${describe(chart.querySelector('svg'))}`);
    }
    resetChips();
    await tick();
    overflow(' (after using every filter)');

    // Feed filters: each choice shows rows or the empty message
    for (const group of document.querySelectorAll('[data-filter-group]')) {
      for (const chip of group.querySelectorAll('.chip')) {
        chip.click();
        await tick();
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
    const sort = document.getElementById('bank-sort');
    if (sort) {
      for (const option of sort.options) { sort.value = option.value; sort.dispatchEvent(new Event('change')); await tick(); }
      sort.value = sort.options[0]?.value;
      sort.dispatchEvent(new Event('change'));
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
      await type('zzqqxxnomatch');
      if (!visible(document.getElementById('search-status'))) add('search', 'no message when nothing matches');
      await type('');
      const hidden = [...document.querySelectorAll('main > section')].filter(s => !visible(s) && s.querySelector('h2')).map(s => s.id);
      if (hidden.length) add('search', `clearing the search leaves sections hidden: ${hidden.join(', ')}`);
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
    // Section links point at visible sections
    for (const a of document.querySelectorAll('.section-nav a[href^="#"]')) {
      if (!visible(document.getElementById(a.getAttribute('href').slice(1)))) add('section link to a hidden section', a.getAttribute('href'));
    }
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
