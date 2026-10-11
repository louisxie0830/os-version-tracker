// Page behaviour: service worker, offline banner, "新" markers, news filters, checker inputs.
// Kept out of the HTML so the Content-Security-Policy can forbid inline scripts.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
const offline = document.getElementById('offline');
const syncOnline = () => { offline.hidden = navigator.onLine; };
window.addEventListener('online', syncOnline);
window.addEventListener('offline', syncOnline);
syncOnline();

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

// Remember the project checker inputs in this browser
try {
  const form = document.getElementById('check-form');
  const saved = JSON.parse(localStorage.getItem('project-config') || 'null');
  if (form && saved && !location.search) {
    for (const [name, value] of Object.entries(saved)) {
      const input = form.elements.namedItem(name);
      if (!input) continue;
      if (input.type === 'checkbox') input.checked = value === '1';
      else input.value = value;
    }
  }
  form?.addEventListener('submit', () => {
    const values = {};
    for (const [name, value] of new FormData(form)) values[name] = String(value);
    localStorage.setItem('project-config', JSON.stringify(values));
  });
  document.getElementById('copy-link')?.addEventListener('click', async event => {
    await navigator.clipboard.writeText(location.href);
    event.target.textContent = '已複製';
  });
} catch {}
