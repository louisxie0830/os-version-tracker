// In-page notification center: a bell with an unread count, a panel listing new requirements,
// announcements, devices and SDK crash reports, and — while the site is open — polling for new
// items that pops a toast and, if allowed, a system notification.
// Read state lives in this browser only (localStorage).
(() => {
  const POLL_MS = 5 * 60 * 1000;
  const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
  const KNOWN_KEY = 'notif-known';
  const READ_KEY = 'notif-read';
  const KIND = { deadline: '期限', 'apple-news': 'Apple 公告', 'android-news': 'Android 公告', device: '新機型', crash: 'SDK 閃退' };

  const bell = document.getElementById('notif-bell');
  const panel = document.getElementById('notif-panel');
  const list = document.getElementById('notif-list');
  const badge = document.getElementById('notif-badge');
  const toasts = document.getElementById('toasts');
  const permissionButton = document.getElementById('notif-permission');
  const dataEl = document.getElementById('notif-data');
  if (!bell || !panel || !list || !badge || !toasts || !dataEl) return;

  const store = {
    get(key) {
      try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set(); }
    },
    set(key, set) {
      try { localStorage.setItem(key, JSON.stringify([...set].slice(-500))); } catch {}
    },
  };

  let { cachedAt, items } = JSON.parse(dataEl.textContent || '{"items":[]}');
  const pageCachedAt = cachedAt;
  const known = store.get(KNOWN_KEY);
  const read = store.get(READ_KEY);

  // Only absolute http(s) links from the feed become clickable (mirrors src/safe-url.ts)
  const safeUrl = value => {
    if (typeof value !== 'string' || /[\u0000-\u001f\u007f\s]/.test(value)) return null;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
    } catch {
      return null;
    }
  };
  const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const when = item => item.firstSeen || `${item.date}T00:00:00Z`;
  // Same rule as the server's "last 7 days": first-seen time, or the publish date of news. A deadline's
  // date is when it takes effect (often in the future), not when it was announced, so it doesn't count.
  const isRecent = item => {
    const at = item.firstSeen ? item.firstSeen : item.kind === 'deadline' ? null : `${item.date}T00:00:00Z`;
    const age = at ? Date.now() - new Date(at).getTime() : -1;
    return age >= 0 && age < RECENT_MS;
  };

  // First visit: only the last 7 days count as unread, so a new reader isn't greeted by dozens of items
  if (!known.size) {
    for (const item of items) if (!isRecent(item)) read.add(item.id);
  }

  function remember(newItems) {
    for (const item of newItems) known.add(item.id);
    store.set(KNOWN_KEY, known);
    store.set(READ_KEY, read);
  }

  function render() {
    const unread = items.filter(item => !read.has(item.id));
    badge.textContent = unread.length > 99 ? '99+' : String(unread.length);
    badge.hidden = unread.length === 0;
    bell.setAttribute('aria-label', unread.length ? `通知，${unread.length} 則未讀` : '通知');
    list.innerHTML = items.length
      ? items.map(item => `<li class="notif-item${read.has(item.id) ? '' : ' unread'}">
          <a ${safeUrl(item.url) ? `href="${escapeHtml(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer"` : 'role="button" tabindex="0"'} data-id="${escapeHtml(item.id)}">
            <span class="notif-meta">
              <span class="tl-platform ${item.platform === 'iOS' ? 'tl-ios' : item.platform === 'Android' ? 'tl-android' : 'tl-cross'}">${escapeHtml(item.platform)}</span>
              <span>${escapeHtml(KIND[item.kind] || '')}</span>
              <span>${escapeHtml((item.firstSeen || item.date).slice(0, 10))}</span>
            </span>
            <span class="notif-title">${escapeHtml(item.title)}</span>
          </a>
        </li>`).join('')
      : '<li class="notif-empty">目前沒有通知</li>';
  }

  function toast(html, actions = '') {
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = `<div class="toast-body">${html}</div>${actions}<button class="toast-close" aria-label="關閉">×</button>`;
    el.querySelector('.toast-close').addEventListener('click', () => el.remove());
    toasts.append(el);
    setTimeout(() => el.remove(), 12_000);
    return el;
  }

  async function systemNotify(newItems) {
    if (!('Notification' in window) || Notification.permission !== 'granted' || !newItems.length) return;
    const title = newItems.length === 1 ? newItems[0].title : `${newItems.length} 項新的規定或公告`;
    const options = {
      body: newItems.length === 1 ? `[${newItems[0].platform}] ${KIND[newItems[0].kind] || ''}` : newItems.slice(0, 3).map(i => `• ${i.title}`).join('\n'),
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: 'os-tracker-updates',
      data: { url: (newItems.length === 1 && safeUrl(newItems[0].url)) || location.href.split('#')[0] },
    };
    try {
      // Android only shows notifications created through the service worker
      const registration = await navigator.serviceWorker?.getRegistration();
      if (registration) await registration.showNotification(title, options);
      else new Notification(title, options);
    } catch {}
  }

  function syncPermissionButton() {
    if (!permissionButton) return;
    if (!('Notification' in window)) {
      permissionButton.hidden = true;
      return;
    }
    const state = Notification.permission;
    permissionButton.hidden = state === 'granted';
    permissionButton.disabled = state === 'denied';
    permissionButton.textContent = state === 'denied' ? '通知已被封鎖（請到瀏覽器設定開啟）' : '開啟系統通知';
  }

  async function poll() {
    try {
      const res = await fetch('notifications.json', { cache: 'no-store' });
      if (!res.ok) return;
      const latest = await res.json();
      const fresh = latest.items.filter(item => !known.has(item.id));
      items = latest.items;
      cachedAt = latest.cachedAt;
      if (fresh.length) {
        remember(fresh);
        render();
        toast(`<strong>${fresh.length} 項新通知</strong><br>${fresh.slice(0, 2).map(i => escapeHtml(i.title)).join('<br>')}`,
          '<button class="btn toast-action" data-open>查看</button>').querySelector('[data-open]')
          ?.addEventListener('click', event => { event.target.closest('.toast')?.remove(); openPanel(); });
        systemNotify(fresh);
      } else if (cachedAt > pageCachedAt && !document.querySelector('.toast[data-refresh]')) {
        const el = toast('資料已更新，重新整理即可看到最新內容', '<button class="btn toast-action" data-reload>重新整理</button>');
        el.dataset.refresh = '';
        el.querySelector('[data-reload]').addEventListener('click', () => location.reload());
      }
    } catch {}
  }

  function openPanel() {
    panel.hidden = false;
    bell.setAttribute('aria-expanded', 'true');
  }

  function closePanel() {
    panel.hidden = true;
    bell.setAttribute('aria-expanded', 'false');
  }

  bell.addEventListener('click', event => {
    event.stopPropagation();
    panel.hidden ? openPanel() : closePanel();
  });
  document.addEventListener('click', event => {
    if (!panel.hidden && !panel.contains(event.target)) closePanel();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closePanel(); });

  list.addEventListener('click', event => {
    const link = event.target.closest('a[data-id]');
    if (!link) return;
    read.add(link.dataset.id);
    store.set(READ_KEY, read);
    render();
  });
  document.getElementById('notif-mark-read')?.addEventListener('click', () => {
    for (const item of items) read.add(item.id);
    store.set(READ_KEY, read);
    render();
  });
  permissionButton?.addEventListener('click', async () => {
    try { await Notification.requestPermission(); } catch {}
    syncPermissionButton();
  });

  // Items that appeared since the previous visit are unread, but don't pop a system notification:
  // the reader is looking at the page already
  remember(items.filter(item => !known.has(item.id)));
  render();
  syncPermissionButton();

  setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); });
})();
