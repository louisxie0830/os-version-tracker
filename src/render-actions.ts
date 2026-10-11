import type { ActionItem, ActionStatus } from './types.js';

// Shared by the server-rendered page and the in-browser project checker, so keep it free of Node APIs

export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  return `<div class="case" style="margin-top:18px">
    <div class="case-head">
      <span class="case-no">${heading}</span>
      <span class="case-count">共 ${actions.length} 項${urgent ? `，${urgent} 項需處理` : ''}</span>
    </div>
  <ul class="actions">${actions.map(a => {
    const title = a.url
      ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a>`
      : esc(a.title);
    return `<li class="action action-${a.status}"${trackNew ? ` data-key="action:${esc(a.title)}"` : ''}>
      <span class="status status-${a.status}">${STATUS_LABEL[a.status]}</span>
      <div class="action-body">
        <div class="action-title">${title}${a.estimated ? '<span class="est" title="依往年慣例推估，非官方公告">推估</span>' : ''}</div>
        <div class="action-detail">${esc(a.detail)}</div>
      </div>
    </li>`;
  }).join('')}</ul></div>`;
}
