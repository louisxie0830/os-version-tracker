// Page behaviour: service worker, offline banner, "新" markers, feed and news filters, search, section links.
// Kept out of the HTML so the Content-Security-Policy can forbid inline scripts. The chip groups, the bank
// table and the trend charts are custom elements in their own scripts (choice-chips.js, bank-table.js,
// trend-charts.js); the feed here listens to the rail's choice-change events.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
const offline = document.getElementById('offline');
const syncOnline = () => { offline.hidden = navigator.onLine; };
window.addEventListener('online', syncOnline);
window.addEventListener('offline', syncOnline);
syncOnline();

// Data that hasn't been refreshed for a day and a half (scheduled runs late, or builds not publishing): say so
// at the top, so nobody acts on old requirements without knowing
try {
  const note = document.getElementById('stale-note');
  const updated = Date.parse(note?.dataset.updated ?? '');
  const STALE_HOURS = 36;
  const check = () => {
    const hours = Math.floor((Date.now() - updated) / 3_600_000);
    note.hidden = hours < STALE_HOURS;
    if (note.hidden) return;
    const age = hours >= 72 ? `${Math.floor(hours / 24)} 天` : `${hours} 小時`;
    note.textContent = `資料已經 ${age}沒有更新，可能是自動更新延遲或資料來源暫時無法取得。內容僅供參考，請以各區塊連結的官方來源為準。`;
  };
  if (note && !Number.isNaN(updated)) {
    check();
    setInterval(check, 30 * 60 * 1000);
  }
} catch {}

// "新" markers: items that appeared since this browser's previous visit
try {
  const KEY = 'seen-items';
  const items = [...document.querySelectorAll('[data-key]')];
  const stored = localStorage.getItem(KEY);
  const seen = new Set(stored ? JSON.parse(stored) : []);
  if (stored) {
    for (const el of items) {
      if (!seen.has(el.dataset.key)) el.classList.add('is-new');
    }
  }
  for (const el of items) seen.add(el.dataset.key);
  localStorage.setItem(KEY, JSON.stringify([...seen].slice(-1000)));
} catch {}

// Developer news: platform / importance filter and "show more"
try {
  const list = document.getElementById('news-list');
  const more = document.getElementById('news-show-more');
  if (list) {
    if (more) list.classList.add('collapsed');
    let filter = 'all';
    const apply = () => {
      let shown = 0;
      for (const li of list.children) {
        const match = filter === 'all' || (filter === 'important' ? li.dataset.important === '1' : li.dataset.platform === filter);
        li.hidden = !match;
        if (match) shown++;
      }
      // With a filter on, show every match; the "show more" cap only applies to the full list
      list.classList.toggle('collapsed', filter === 'all' && !!more && !more.dataset.expanded);
      if (more) more.hidden = filter !== 'all' || !!more.dataset.expanded;
      let empty = list.parentElement.querySelector('.news-empty');
      if (!shown && !empty) list.insertAdjacentHTML('afterend', '<div class="news-empty">沒有符合的新聞</div>');
      if (shown && empty) empty.remove();
    };
    document.querySelectorAll('.news-filters .chip').forEach(chip => chip.addEventListener('click', () => {
      filter = chip.dataset.filter;
      document.querySelectorAll('.news-filters .chip').forEach(c => c.classList.toggle('is-active', c === chip));
      apply();
    }));
    more?.addEventListener('click', () => { more.dataset.expanded = '1'; apply(); });
  }
} catch {}

// Feed: type / platform chips and the search box filter the "now" cards and the feed; "load more" uncaps the feed
try {
  const items = [...document.querySelectorAll('[data-feed-item]')];
  const more = document.getElementById('feed-more');
  const search = document.getElementById('search');
  const filters = { type: 'all', platform: 'all' };
  const apply = () => {
    const q = (search?.value ?? '').trim().toLowerCase();
    const filtering = filters.type !== 'all' || filters.platform !== 'all' || q !== '';
    const shown = { now: 0, feed: 0 };
    for (const el of items) {
      const match = (filters.type === 'all' || el.dataset.type === filters.type)
        && (filters.platform === 'all' || el.dataset.platform === filters.platform)
        && (!q || el.textContent.toLowerCase().includes(q));
      // Without a filter only the first rows show until "load more"; with one, every match shows
      const capped = !filtering && el.classList.contains('feed-extra') && !more?.dataset.expanded;
      el.hidden = !match || capped;
      if (match) shown[el.closest('#now') ? 'now' : 'feed']++;
    }
    if (more) more.hidden = filtering || !!more.dataset.expanded;
    const nowEmpty = document.getElementById('now-empty');
    if (nowEmpty) nowEmpty.hidden = !filtering || shown.now > 0 || !document.querySelector('#now [data-feed-item]');
    const feedEmpty = document.getElementById('feed-empty');
    if (feedEmpty && document.querySelector('#feed [data-feed-item]')) feedEmpty.hidden = shown.feed > 0;
  };
  // The rail's type / platform groups are <choice-chips> (choice-chips.js), which keep the chips' state
  document.querySelectorAll('.rail choice-chips').forEach(group => group.addEventListener('choice-change', event => {
    const { name, value } = event.detail ?? {};
    if (!(name in filters)) return;
    filters[name] = value;
    apply();
  }));
  // Whole-page search: rows in the other sections are matched too; sections with nothing left hide
  const ROWS = '.crash-list > li, .news-feed > li, .actions > li, .timeline > li, .compat-table tbody tr, .privacy-card, .tile, .version-card, .now-card, .feed-row';
  const status = document.getElementById('search-status');
  const searchPage = q => {
    document.body.classList.toggle('searching', q !== '');
    let rows = 0;
    for (const section of document.querySelectorAll('main > section')) {
      if (section.id === 'now' || section.id === 'feed') continue;
      const inSection = [...section.querySelectorAll(ROWS)];
      // A card or table whose heading matches keeps all its rows (e.g. "AGP" names a table of version numbers)
      const headingOf = el => {
        const card = el.closest('.case');
        if (card) return card.querySelector('.case-head')?.textContent ?? '';
        let prev = el.closest('.table-wrap')?.previousElementSibling;
        while (prev?.classList.contains('table-note')) prev = prev.previousElementSibling;
        return prev?.textContent ?? '';
      };
      let hits = 0;
      for (const row of inSection) {
        const miss = q !== '' && !row.textContent.toLowerCase().includes(q) && !headingOf(row).toLowerCase().includes(q);
        row.classList.toggle('search-miss', miss);
        if (!miss) hits++;
      }
      for (const card of section.querySelectorAll('.case, .table-wrap')) {
        const own = [...card.querySelectorAll(ROWS)];
        card.classList.toggle('search-miss', q !== '' && own.length > 0 && own.every(r => r.classList.contains('search-miss')));
      }
      const matches = q === '' || (inSection.length ? hits > 0 : section.textContent.toLowerCase().includes(q));
      section.classList.toggle('search-miss', !matches);
      if (q && inSection.length) rows += hits;
    }
    if (status) {
      status.hidden = q === '';
      const top = items.filter(el => !el.hidden).length;
      status.querySelector('[data-search-summary]').textContent = `「${search.value.trim()}」：待處理與動態 ${top} 筆，其他區塊 ${rows} 筆`;
    }
  };
  let timer;
  search?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { apply(); searchPage((search.value ?? '').trim().toLowerCase()); }, 120);
  });
  document.getElementById('search-clear')?.addEventListener('click', () => {
    search.value = '';
    apply();
    searchPage('');
    search.focus();
  });
  search?.addEventListener('keydown', event => {
    if (event.key === 'Enter') document.getElementById('now')?.scrollIntoView({ block: 'start' });
  });
  more?.addEventListener('click', () => { more.dataset.expanded = '1'; apply(); });
} catch {}

// Horizontal scrollers (section nav and filter chips on narrower windows): a mouse wheel scrolls them
// sideways, and the edge with more content fades so it's clear there is more
try {
  const scrollers = [...document.querySelectorAll('.section-nav, .chips')];
  const edges = el => {
    const more = el.scrollWidth - el.clientWidth > 1;
    el.classList.toggle('is-scroll-more-left', more && el.scrollLeft > 1);
    el.classList.toggle('is-scroll-more-right', more && el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  };
  for (const el of scrollers) {
    edges(el);
    el.addEventListener('scroll', () => edges(el), { passive: true });
    el.addEventListener('wheel', event => {
      const room = el.scrollWidth - el.clientWidth;
      // Only a vertical wheel over a horizontal scroller; trackpads already scroll sideways
      if (room <= 1 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const next = Math.max(0, Math.min(room, el.scrollLeft + event.deltaY));
      // At either end the page scrolls as usual
      if (next === el.scrollLeft) return;
      event.preventDefault();
      el.scrollLeft = next;
    }, { passive: false });
  }
  addEventListener('resize', () => scrollers.forEach(edges), { passive: true });
} catch {}

// Back to top: shown once the reader is a screen down; focus returns to the top of the page
try {
  const button = document.getElementById('to-top');
  if (button) {
    let frame = 0;
    const sync = () => { frame = 0; button.hidden = scrollY < innerHeight; };
    addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(sync); }, { passive: true });
    sync();
    button.addEventListener('click', () => {
      scrollTo({ top: 0 });
      // Keyboard users continue from the top instead of from a now-hidden button
      document.querySelector('.brand')?.focus({ preventScroll: true });
    });
  }
} catch {}

// Section links: mark the section currently in view
try {
  const links = new Map([...document.querySelectorAll('.section-nav a[href^="#"]')].map(a => [a.getAttribute('href').slice(1), a]));
  const ids = [...links.keys()];
  const visible = new Set();
  let shown;
  const update = () => {
    // The first section in page order that is in view wins; at the very bottom the last sections
    // can't reach the band, so the last one wins
    const atBottom = innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
    const current = atBottom ? ids.at(-1) : ids.find(id => visible.has(id));
    if (current === shown) return;
    shown = current;
    for (const [id, a] of links) {
      a.classList.toggle('is-current', id === current);
      if (id === current) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    }
    // In the horizontal nav (narrow screens), keep the current link in view
    const link = links.get(current);
    const nav = link?.parentElement;
    if (nav && nav.scrollWidth > nav.clientWidth) {
      nav.scrollTo({ left: link.offsetLeft - (nav.clientWidth - link.offsetWidth) / 2, behavior: 'smooth' });
    }
  };
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) entry.isIntersecting ? visible.add(entry.target.id) : visible.delete(entry.target.id);
    update();
  }, { rootMargin: '-20% 0px -60% 0px' });
  for (const id of ids) {
    const section = document.getElementById(id);
    if (section) observer.observe(section);
  }
  let frame = 0;
  addEventListener('scroll', () => {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; update(); });
  }, { passive: true });
} catch {}

// "/" jumps to the search box (unless the reader is already typing somewhere)
try {
  const search = document.getElementById('search');
  addEventListener('keydown', event => {
    if (!search || event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) return;
    event.preventDefault();
    search.focus();
    search.select();
  });
} catch {}

// Copy a link to a section: a small button after each section heading
try {
  const LINK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>';
  const toasts = document.getElementById('toasts');
  const say = text => {
    if (!toasts) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = text;
    toasts.append(el);
    setTimeout(() => el.remove(), 2500);
  };
  for (const heading of document.querySelectorAll('main > section[id] > h2, main > section[id] .feed-h')) {
    const section = heading.closest('section[id]');
    const name = heading.textContent.trim();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-link';
    button.title = '複製這個區塊的連結';
    button.setAttribute('aria-label', `複製「${name}」的連結`);
    button.innerHTML = LINK_ICON;
    button.addEventListener('click', async () => {
      const url = new URL(location.href);
      url.hash = section.id;
      try {
        await navigator.clipboard.writeText(url.href);
        say(`已複製「${name}」的連結`);
      } catch {
        // No clipboard access (e.g. an insecure context): put the link in the address bar instead
        history.replaceState(null, '', url.href);
        say('已把連結放到網址列，可直接複製');
      }
    });
    heading.append(button);
  }
} catch {}

// The project checker was removed; drop the inputs it remembered
try { localStorage.removeItem('project-config'); } catch {}
