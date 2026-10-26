// Theme: follows the system unless the reader picked one with the toggle (remembered in this browser).
// Loaded synchronously in <head> so the page never flashes the wrong theme.
(() => {
  const KEY = 'theme';
  const root = document.documentElement;
  // Script runs: lists capped behind "show more" collapse from the first paint (see the stylesheet). If app.js
  // then never ran (it failed to load), or the part behind one list failed, that list would stay capped behind
  // a button that does nothing: by the load event deferred scripts have run, and every working button is
  // marked data-wired, so one that isn't means the page goes back to showing everything
  root.classList.add('has-js');
  addEventListener('load', () => {
    if (document.querySelector('[data-show-more]:not([data-wired])')) root.classList.remove('has-js');
  });
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
  } catch {}
  const isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('theme-toggle');
    if (!button) return;
    const sync = () => {
      button.setAttribute('aria-pressed', String(isDark()));
      button.setAttribute('aria-label', isDark() ? '切換淺色模式' : '切換深色模式');
      // The browser's bar follows the theme in use, not only the system's (both metas: whichever media matches)
      document.querySelectorAll('meta[name="theme-color"]').forEach(meta => meta.setAttribute('content', isDark() ? '#14191c' : '#fbfaf7'));
    };
    button.addEventListener('click', () => {
      root.dataset.theme = isDark() ? 'light' : 'dark';
      try { localStorage.setItem(KEY, root.dataset.theme); } catch {}
      sync();
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', sync);
    sync();
  });
})();
