import type { RefreshDiagnostics, SourceKey } from './fetch-all.js';
import type { PublishDecision } from './publish-health.js';
import type { SourceInfo } from './types.js';

/**
 * The GitHub Actions run summary (Markdown appended to $GITHUB_STEP_SUMMARY): one row per source with its
 * status, item counts and what went wrong, so a run's data health shows on its page without reading logs.
 */

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

function taipei(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  // Taipei has no daylight saving time: UTC+8 all year
  const t = new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString();
  return `${t.slice(5, 7)}/${t.slice(8, 10)} ${t.slice(11, 16)}`;
}

export function buildRunSummary(
  sources: Partial<Record<SourceKey, SourceInfo>>,
  diagnostics: RefreshDiagnostics,
  decision: PublishDecision,
): string {
  // Sources finish in a different order every run: list them alphabetically so runs compare line by line
  const rows = (Object.entries(sources) as Array<[SourceKey, SourceInfo]>).sort(([a], [b]) => a.localeCompare(b)).map(([key, info]) => {
    const problems = diagnostics.quality[key] ?? [];
    const status = !info.ok ? '❌ 失敗' : problems.length ? '⚠️ 不完整' : '✅ 正常';
    // One list: just the number; several: each with its name ("appleReleases 14 · androidBulletins 3")
    const lists = Object.entries(diagnostics.counts[key] ?? {});
    const counts = lists.length === 1 ? String(lists[0][1]) : lists.map(([name, n]) => `${name.split('.').pop()} ${n}`).join(' · ');
    const note = !info.ok ? diagnostics.errors[key] ?? '抓取或解析失敗' : problems.join('\n');
    return { order: !info.ok ? 0 : problems.length ? 1 : 2, line: `| ${status} | \`${key}\` | ${cell(info.label)} | ${counts || '—'} | ${taipei(info.fetchedAt)} | ${note ? cell(note) : ''} |` };
  });
  const failed = rows.filter(r => r.order === 0).length;
  const incomplete = rows.filter(r => r.order === 1).length;
  return [
    '## 資料來源',
    '',
    `${decision.publish ? '✅ 已發布' : `❌ 未發布：${decision.reason}`} · 成功 ${decision.healthy}/${decision.total}${failed ? ` · 失敗 ${failed}` : ''}${incomplete ? ` · 不完整 ${incomplete}` : ''}`,
    '',
    '| 狀態 | 來源 | 名稱 | 筆數 | 抓取時間（台灣） | 說明 |',
    '| --- | --- | --- | --- | --- | --- |',
    // Problems first, then the rest
    ...rows.map((r, i) => ({ ...r, i })).sort((a, b) => a.order - b.order || a.i - b.i).map(r => r.line),
    '',
  ].join('\n');
}
