import type { ActionBasis, ActionItem, ActionStatus } from './types.js';
import { safeUrl } from './safe-url.js';

// Rendering helpers for the action lists; kept free of Node APIs

export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * An external link when `url` is a safe http(s) URL; otherwise the content as plain text,
 * so malformed or active-scheme URLs from upstream data can never become clickable.
 * `html` must already be escaped.
 */
export function externalLink(url: unknown, html: string, className = ''): string {
  const href = safeUrl(url);
  const cls = className ? ` class="${className}"` : '';
  return href
    ? `<a${cls} href="${esc(href)}" target="_blank" rel="noopener noreferrer">${html}</a>`
    : `<span${cls}>${html}</span>`;
}

const BASIS: Record<ActionBasis, { label: string; hint: string }> = {
  official: { label: '官方', hint: '依官方規定、公告或相容性表' },
  estimate: { label: '推估', hint: '依往年慣例推估，非官方公告' },
  community: { label: '社群', hint: '社群回報，未經官方確認' },
  reference: { label: '參考', hint: '第三方統計數據，僅供參考' },
};

const BASIS_LEGEND = (Object.keys(BASIS) as ActionBasis[])
  .map(k => `<span class="basis basis-${k}">${BASIS[k].label}</span>${BASIS[k].hint}`).join('　');

export function basisOf(a: ActionItem): ActionBasis {
  return a.basis ?? (a.estimated ? 'estimate' : 'official');
}

/** Small tag telling official requirements, estimates, community reports and statistics apart */
export function basisTag(a: ActionItem): string {
  const b = BASIS[basisOf(a)];
  return `<span class="basis basis-${basisOf(a)}" title="${b.hint}">${b.label}</span>`;
}

export const STATUS_LABEL: Record<ActionStatus, string> = {
  urgent: '需處理',
  upcoming: '提前規劃',
  ok: '已生效',
  info: '資訊',
};

export function renderActions(actions: ActionItem[], heading = '開發者須知', trackNew = true): string {
  if (!actions.length) return '';
  const urgent = actions.filter(a => a.status === 'urgent').length;
  return `<div class="case mt-18">
    <div class="case-head">
      <span class="case-no">${heading}</span>
      <span class="case-count">共 ${actions.length} 項${urgent ? `，${urgent} 項需處理` : ''}</span>
    </div>
  <ul class="actions">${actions.map(a => {
    const title = externalLink(a.url, esc(displayDate(a.title)));
    return `<li class="action action-${a.status}"${trackNew ? ` data-key="action:${esc(a.title)}"` : ''}>
      <span class="status status-${a.status}">${STATUS_LABEL[a.status]}</span>
      <div class="action-body">
        <div class="action-title">${title}${basisTag(a)}</div>
        <div class="action-detail">${esc(displayDate(a.detail))}</div>
      </div>
    </li>`;
  }).join('')}</ul>
  <div class="basis-legend">${BASIS_LEGEND}</div></div>`;
}

/**
 * Dates as readers see them on the page: "2027-01-27" → "2027/01/27", "2026-09" → "2026/09".
 * Display only: the data, API and URLs keep ISO dates. Version numbers (dots) and IDs such as
 * "CVE-2026-86950" are left alone (word boundaries).
 */
export function displayDate(text: string): string {
  return text.replace(/\b(\d{4})-(\d{2})(?:-(\d{2}))?\b/g, (_, y, m, d) => (d ? `${y}/${m}/${d}` : `${y}/${m}`));
}
