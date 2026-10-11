// Runs the project checker in the browser on the static site, where there is no server to compute it.
// Only imports browser-safe modules; build-static verifies the module graph has no Node built-ins.
import { checkProject, parseConfig, upgradePlan } from '../checker.js';
import type { AllVersions } from '../fetch-all.js';
import { renderActions, renderUpgradePlan } from '../render-actions.js';

const form = document.getElementById('check-form') as HTMLFormElement | null;
const results = document.getElementById('check-results');
const dataEl = document.getElementById('checker-data');

if (form && results && dataEl?.textContent) {
  const data = JSON.parse(dataEl.textContent) as AllVersions;
  const copyButton = document.getElementById('copy-link');
  const clearLink = document.getElementById('clear-check');

  const render = (params: URLSearchParams) => {
    const config = parseConfig(params);
    copyButton?.toggleAttribute('hidden', !config);
    clearLink?.toggleAttribute('hidden', !config);
    if (!config) {
      results.innerHTML = '';
      return;
    }
    const { ios, android } = checkProject(config, data);
    const single = !(ios.length && android.length);
    results.innerHTML = `${renderUpgradePlan('iOS', upgradePlan(ios, 'ios'))}${renderUpgradePlan('Android', upgradePlan(android, 'android'))}
    <div class="check-results${single ? ' single' : ''}">
      ${ios.length ? renderActions(ios, 'iOS 檢查結果', false) : ''}
      ${android.length ? renderActions(android, 'Android 檢查結果', false) : ''}
      ${!ios.length && !android.length ? '<div class="empty">沒有可檢查的項目，請至少填一個欄位。</div>' : ''}
    </div>`;
  };

  // Shared result links carry the inputs in the query string; otherwise reuse the configuration this
  // browser saved last time (the page's inline script stores it under "project-config")
  let initial = new URLSearchParams(location.search);
  if (!parseConfig(initial)) {
    try {
      const saved = JSON.parse(localStorage.getItem('project-config') || 'null') as Record<string, string> | null;
      if (saved) initial = new URLSearchParams(Object.entries(saved).filter(([, v]) => v));
    } catch { /* storage unavailable */ }
  }
  if (parseConfig(initial)) {
    for (const [name, value] of initial) {
      const input = form.elements.namedItem(name);
      if (input instanceof HTMLInputElement) {
        if (input.type === 'checkbox') input.checked = value === '1';
        else input.value = value;
      }
    }
    render(initial);
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [name, value] of new FormData(form)) {
      if (String(value).trim()) params.set(name, String(value).trim());
    }
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}#checker`);
    render(params);
  });
}
