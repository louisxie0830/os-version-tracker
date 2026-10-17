// Theme: follows the system unless the reader picked one with the toggle (remembered in this browser).
// Loaded synchronously in <head> so the page never flashes the wrong theme.
(() => {
  const KEY = 'theme';
  const root = document.documentElement;
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
