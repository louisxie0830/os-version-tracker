// Page behaviour that isn't a component: service worker, offline banner, stale-data note, "新" markers, back to
// top and section links. Kept out of the HTML so the Content-Security-Policy can forbid inline scripts.
// Filtering, searching, the section list and the notification center are custom elements; this is the last
// part of app.js, after them (asset-versions.ts APP_PARTS).
// Each part is a block of its own: this is a classic script, so top-level declarations would be globals.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

{
  const offline = document.getElementById('offline');
  const syncOnline = (): void => { if (offline) offline.hidden = navigator.onLine; };
  window.addEventListener('online', syncOnline);
  window.addEventListener('offline', syncOnline);
  syncOnline();
}

// Data that hasn't been refreshed for a day and a half (scheduled runs late, or builds not publishing): say so
// at the top, so nobody acts on old requirements without knowing
try {
  const note = document.getElementById('stale-note');
  const updated = Date.parse(note?.dataset.updated ?? '');
  const STALE_HOURS = 36;
  const check = (): void => {
    if (!note) return;
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
  const items = [...document.querySelectorAll<HTMLElement>('[data-key]')];
  const stored = localStorage.getItem(KEY);
  const seen = new Set<string>(stored ? JSON.parse(stored) as string[] : []);
  if (stored) {
    for (const el of items) {
      if (!seen.has(el.dataset.key ?? '')) el.classList.add('is-new');
    }
  }
  // Moved to the end when still on the page: the size limit then drops keys no longer shown, never one shown
  for (const el of items) { seen.delete(el.dataset.key ?? ''); seen.add(el.dataset.key ?? ''); }
  localStorage.setItem(KEY, JSON.stringify([...seen].slice(-1000)));
} catch {}

// Back to top: shown once the reader is a screen down; focus returns to the top of the page
try {
  const button = document.getElementById('to-top');
  if (button) {
    let frame = 0;
    const sync = (): void => { frame = 0; button.hidden = scrollY < innerHeight; };
    addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(sync); }, { passive: true });
    sync();
    button.addEventListener('click', () => {
      scrollTo({ top: 0 });
      // Keyboard users continue from the top instead of from a now-hidden button
      document.querySelector<HTMLElement>('.brand')?.focus({ preventScroll: true });
    });
  }
} catch {}

// Copy a link to a section: a small button after each section heading
try {
  const LINK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>';
  for (const heading of document.querySelectorAll('main > section[id] > h2, main > section[id] .feed-h')) {
    const section = heading.closest('section[id]');
    if (!section) continue;
    const name = heading.textContent.trim();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-link';
    button.title = '複製這個區塊的連結';
    button.setAttribute('aria-label', `複製「${name}」的連結`);
    button.innerHTML = LINK_ICON;
    button.addEventListener('click', async () => {
      // The address keeps the chosen filters (?f-type=…) and search, so the link opens the same view
      const url = new URL(location.href);
      url.hash = section.id;
      try {
        await navigator.clipboard.writeText(url.href);
        showToast(`已複製「${name}」的連結`);
      } catch {
        // No clipboard access (e.g. an insecure context): put the link in the address bar instead
        history.replaceState(null, '', url.href);
        showToast('已把連結放到網址列，可直接複製');
      }
    });
    heading.append(button);
  }
} catch {}

// The project checker was removed; drop the inputs it remembered
try { localStorage.removeItem('project-config'); } catch {}

// A box that scrolls sideways (a wide table on a narrow screen) can be reached and scrolled with the keyboard:
// it becomes a named, focusable region while it actually overflows, and stops being one when it doesn't.
// Each box is measured when it comes near the screen or changes size, not all at once on load
try {
  const sync = (box: HTMLElement): void => {
    const scrolls = box.scrollWidth > box.clientWidth + 1 && getComputedStyle(box).overflowX !== 'visible';
    if (scrolls && !box.hasAttribute('tabindex')) {
      const name = box.closest('.case')?.querySelector('.case-no')?.textContent?.trim()
        ?? box.closest('section')?.querySelector('h2')?.textContent?.trim() ?? '表格';
      box.tabIndex = 0;
      box.setAttribute('role', 'region');
      box.setAttribute('aria-label', `${name}（可左右捲動）`);
    } else if (!scrolls && box.getAttribute('role') === 'region') {
      box.removeAttribute('tabindex');
      box.removeAttribute('role');
      box.removeAttribute('aria-label');
    }
  };
  const boxes = document.querySelectorAll<HTMLElement>('.table-wrap');
  if (typeof ResizeObserver === 'function' && typeof IntersectionObserver === 'function') {
    // Size changes (a resize, a <details> opening) of a box in view; boxes out of view wait until they're near
    const resized = new ResizeObserver(entries => { for (const e of entries) sync(e.target as HTMLElement); });
    const near = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) resized.observe(e.target); else resized.unobserve(e.target);
      }
    }, { rootMargin: '200px 0px' });
    boxes.forEach(box => near.observe(box));
  }
} catch {}

// The top bar's real height, for everything placed under it (the section nav, the notification panel, where
// jumps land): it changes with the width (the bar wraps onto two rows) and the text size, so the stylesheet's
// own figure is only the starting guess
try {
  const bar = document.querySelector<HTMLElement>('.topbar');
  if (bar && typeof ResizeObserver === 'function') {
    const measure = () => {
      if (getComputedStyle(bar).position === 'static') document.documentElement.style.removeProperty('--topbar-h');
      else document.documentElement.style.setProperty('--topbar-h', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
    };
    new ResizeObserver(measure).observe(bar);
    // A short window (a phone turned sideways) lets the bar scroll away without changing its size
    window.matchMedia?.('(max-height: 31.25em)').addEventListener?.('change', measure);
  }
} catch {}
