// <notif-center>: the in-page notification center. A bell with an unread count, a panel (a non-modal dialog)
// listing new requirements, announcements, devices and SDK crash reports, and, while the site is open and
// visible, polling for new items that pops a toast and, if allowed, a system notification. Read state lives
// in this browser only (localStorage). The items come from the JSON in script[data-notif-items] inside it.
// Opening the panel moves focus into it; Escape closes it and returns focus to the bell, and focus leaving
// the notification center (Tab past the panel, a click elsewhere) closes it.
{
  /** One item of notifications.json (changes.ts buildNotificationsJson) */
  interface NotifItem {
    id: string;
    kind: string;
    /** How the item's kind is named, and the class of its platform tag (changes.ts buildNotificationsJson) */
    kindLabel?: string;
    platform: string;
    platformClass?: string;
    title: string;
    url?: string;
    date: string;
    /** A deadline announced by month or year only */
    datePrecision?: 'month' | 'year';
    firstSeen?: string;
    author?: { name: string };
  }
  interface NotifData {
    cachedAt: string;
    items: NotifItem[];
  }

  const POLL_MS = 5 * 60 * 1000;
  /** Coming back to the tab checks again, but not more often than this */
  const MIN_POLL_GAP_MS = 60 * 1000;
  const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
  const KNOWN_KEY = 'notif-known';
  const READ_KEY = 'notif-read';

  const store = {
    get(key: string): Set<string> {
      try { return new Set(JSON.parse(localStorage.getItem(key) || '[]') as string[]); } catch { return new Set(); }
    },
    set(key: string, set: Set<string>): void {
      try { localStorage.setItem(key, JSON.stringify([...set].slice(-500))); } catch {}
    },
  };

  // Same rule as the server's "last 7 days" (changes.ts recentItems): first-seen time, or the publish date of
  // news, and a published item must itself be at most NEW_MAX_AGE_DAYS old. A deadline's date is when it takes
  // effect (often in the future), not when it was announced, so it doesn't count.
  const PUBLISHED_KINDS = new Set(['apple-news', 'android-news', 'dev-news', 'device', 'crash', 'security']);
  const NEW_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const isRecent = (item: NotifItem): boolean => {
    if (PUBLISHED_KINDS.has(item.kind) && Date.now() - new Date(`${item.date}T00:00:00Z`).getTime() > NEW_MAX_AGE_MS) return false;
    const at = item.firstSeen ? item.firstSeen : item.kind === 'deadline' ? null : `${item.date}T00:00:00Z`;
    const age = at ? Date.now() - new Date(at).getTime() : -1;
    return age >= 0 && age < RECENT_MS;
  };
  const span = (className: string, text: string): HTMLSpanElement => {
    const el = document.createElement('span');
    el.className = className;
    el.textContent = text;
    return el;
  };

  defineElement('notif-center', class extends LightElement {
    protected setup(signal: AbortSignal): boolean {
      const bell = this.querySelector<HTMLButtonElement>('[data-notif-bell]');
      const panel = this.querySelector<HTMLElement>('[data-notif-panel]');
      const list = this.querySelector<HTMLElement>('[data-notif-list]');
      const badge = this.querySelector<HTMLElement>('[data-notif-badge]');
      const source = this.querySelector('script[data-notif-items]');
      const permissionButton = this.querySelector<HTMLButtonElement>('[data-notif-permission]');
      if (!bell || !panel || !list || !badge || !source) return false;

      let data: NotifData;
      try { data = JSON.parse(source.textContent || '') as NotifData; } catch { data = { cachedAt: '', items: [] }; }
      let { cachedAt, items } = data;
      const pageCachedAt = cachedAt;
      const known = store.get(KNOWN_KEY);
      const read = store.get(READ_KEY);

      // First visit: only the last 7 days count as unread, so a new reader isn't greeted by dozens of items
      if (!known.size) {
        for (const item of items) if (!isRecent(item)) read.add(item.id);
      }

      const remember = (newItems: NotifItem[]): void => {
        for (const item of newItems) known.add(item.id);
        // Still listed: moved to the end, so what the size limit drops first is no longer listed (else an old
        // item still listed would be forgotten and come back as new)
        for (const item of items) for (const set of [known, read]) if (set.delete(item.id)) set.add(item.id);
        store.set(KNOWN_KEY, known);
        store.set(READ_KEY, read);
      };

      // An item with a safe link opens it; one without is a button, so the keyboard can mark it read too
      const entry = (item: NotifItem): HTMLLIElement => {
        const li = document.createElement('li');
        li.className = `notif-item${read.has(item.id) ? '' : ' unread'}`;
        const url = safeLinkUrl(item.url);
        let target: HTMLAnchorElement | HTMLButtonElement;
        if (url) {
          target = document.createElement('a');
          target.href = url;
          target.target = '_blank';
          target.rel = 'noopener noreferrer';
        } else {
          target = document.createElement('button');
          target.type = 'button';
        }
        target.className = 'notif-entry';
        target.dataset.id = item.id;
        const meta = span('notif-meta', '');
        meta.append(
          span(`tl-platform ${item.platformClass ?? ''}`, item.platform),
          span('', item.kindLabel ?? ''),
          // A post shows when it was published (as the feed does, changes.ts shownDate); the rest when they appeared
          span('', (PUBLISHED_KINDS.has(item.kind) && item.date ? item.date : item.firstSeen || item.date).slice(0, 10).replace(/-/g, '/')),
          // A requirement also says when it takes effect, as the webhook message does
          ...(item.kind === 'deadline' && item.date ? [span('', `生效 ${item.datePrecision === 'year' ? `${item.date.slice(0, 4)} 年內` : item.datePrecision === 'month' ? `${item.date.slice(0, 4)}/${Number(item.date.slice(5, 7))} 月` : item.date.slice(0, 10).replace(/-/g, '/')}`)] : []),
        );
        target.append(meta, span('notif-title', item.title));
        if (item.author) target.append(span('notif-meta', `作者 ${item.author.name}`));
        li.append(target);
        return li;
      };

      const render = (): void => {
        // Rebuilding the list mustn't drop the reader's focus: it goes back to the same item
        const focusedId = list.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.id : undefined;
        const unread = items.filter(item => !read.has(item.id));
        badge.textContent = unread.length > 99 ? '99+' : String(unread.length);
        badge.hidden = unread.length === 0;
        bell.setAttribute('aria-label', unread.length ? `通知，${unread.length} 則未讀` : '通知');
        if (items.length) list.replaceChildren(...items.map(entry));
        else {
          const empty = document.createElement('li');
          empty.className = 'notif-empty';
          empty.textContent = '目前沒有通知';
          list.replaceChildren(empty);
        }
        if (focusedId !== undefined) {
          const entries = [...list.querySelectorAll<HTMLElement>('.notif-entry')];
          (entries.find(e => e.dataset.id === focusedId) ?? entries[0] ?? panel).focus();
        }
      };

      const systemNotify = async (newItems: NotifItem[]): Promise<void> => {
        if (!('Notification' in window) || Notification.permission !== 'granted' || !newItems.length) return;
        const title = newItems.length === 1 ? newItems[0].title : `${newItems.length} 項新的規定或公告`;
        const options: NotificationOptions = {
          body: newItems.length === 1 ? `[${newItems[0].platform}] ${newItems[0].kindLabel ?? ''}` : newItems.slice(0, 3).map(i => `• ${i.title}`).join('\n'),
          icon: 'icons/icon-192.png',
          badge: 'icons/icon-192.png',
          tag: 'os-tracker-updates',
          data: { url: (newItems.length === 1 && safeLinkUrl(newItems[0].url)) || location.href.split('#')[0] },
        };
        try {
          // Android only shows notifications created through the service worker
          const registration = await navigator.serviceWorker?.getRegistration();
          if (registration) await registration.showNotification(title, options);
          else new Notification(title, options);
        } catch {}
      };

      const syncPermissionButton = (): void => {
        if (!permissionButton) return;
        if (!('Notification' in window)) {
          permissionButton.hidden = true;
          return;
        }
        const state = Notification.permission;
        permissionButton.hidden = state === 'granted';
        permissionButton.disabled = state === 'denied';
        permissionButton.textContent = state === 'denied' ? '通知已被封鎖（請到瀏覽器設定開啟）' : '開啟系統通知';
      };

      const openPanel = (): void => {
        panel.hidden = false;
        bell.setAttribute('aria-expanded', 'true');
        // Into the panel: its first item, or the panel itself when there is none
        (panel.querySelector<HTMLElement>('.notif-entry') ?? panel).focus();
      };
      const closePanel = (returnFocus: boolean): void => {
        if (panel.hidden) return;
        panel.hidden = true;
        bell.setAttribute('aria-expanded', 'false');
        if (returnFocus) bell.focus();
      };

      let lastPoll = Date.now();
      const poll = async (): Promise<void> => {
        if (Date.now() - lastPoll < MIN_POLL_GAP_MS) return;
        lastPoll = Date.now();
        try {
          const res = await fetch('notifications.json', { cache: 'no-store' });
          if (!res.ok) return;
          const latest = await res.json() as NotifData;
          const fresh = latest.items.filter(item => !known.has(item.id));
          const changed = latest.items.length !== items.length || latest.items.some((item, i) => item.id !== items[i]?.id);
          items = latest.items;
          cachedAt = latest.cachedAt;
          // The list and the count always follow the items (an item can also drop out)
          if (changed) render();
          if (fresh.length) {
            remember(fresh);
            const heading = document.createElement('strong');
            heading.textContent = `${fresh.length} 項新通知`;
            const titles = fresh.slice(0, 2).flatMap(i => [document.createElement('br'), document.createTextNode(i.title)]);
            showToast([heading, ...titles], { actions: [{ label: '查看', run: openPanel }], closable: true, timeout: 12_000 });
            void systemNotify(fresh);
          } else if (cachedAt > pageCachedAt && !document.querySelector('.toast[data-refresh]')) {
            const toast = showToast('資料已更新，重新整理即可看到最新內容', { actions: [{ label: '重新整理', run: () => location.reload() }], closable: true, timeout: 12_000 });
            if (toast) toast.dataset.refresh = '';
          }
        } catch {}
      };

      bell.addEventListener('click', event => {
        event.stopPropagation();
        if (panel.hidden) openPanel(); else closePanel(false);
      }, { signal });
      document.addEventListener('click', event => {
        if (event.target instanceof Node && !panel.contains(event.target)) closePanel(false);
      }, { signal });
      this.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !panel.hidden) closePanel(true);
      }, { signal });
      // Focus moving somewhere else on the page (not leaving the window: then there is no relatedTarget)
      this.addEventListener('focusout', event => {
        if (event.relatedTarget instanceof Node && !this.contains(event.relatedTarget)) closePanel(false);
      }, { signal });
      list.addEventListener('click', event => {
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.notif-entry') : null;
        if (!target?.dataset.id) return;
        read.add(target.dataset.id);
        store.set(READ_KEY, read);
        target.closest('.notif-item')?.classList.remove('unread');
        const unread = items.filter(item => !read.has(item.id)).length;
        badge.textContent = unread > 99 ? '99+' : String(unread);
        badge.hidden = unread === 0;
        bell.setAttribute('aria-label', unread ? `通知，${unread} 則未讀` : '通知');
      }, { signal });
      this.querySelector('[data-notif-mark-read]')?.addEventListener('click', () => {
        for (const item of items) read.add(item.id);
        store.set(READ_KEY, read);
        render();
      }, { signal });
      permissionButton?.addEventListener('click', async () => {
        try { await Notification.requestPermission(); } catch {}
        syncPermissionButton();
      }, { signal });

      // Items that appeared since the previous visit are unread, but don't pop a system notification:
      // the reader is looking at the page already
      remember(items.filter(item => !known.has(item.id)));
      render();
      syncPermissionButton();

      // Only while the page is visible: a background tab checks again when it comes back
      const timer = setInterval(() => { if (document.visibilityState === 'visible') void poll(); }, POLL_MS);
      signal.addEventListener('abort', () => clearInterval(timer));
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void poll(); }, { signal });
      return true;
    }
  });
}
