import { cleanText } from './fetchers/html-table.js';
import { safeUrl } from './safe-url.js';
import type { DevNewsItem } from './fetchers/dev-news.js';
import type { SecurityPlatform, SecurityReport } from './fetchers/security.js';

export interface SecuritySourceState {
  id: string;
  label: string;
  url: string;
  status: 'ok' | 'partial' | 'failed';
  checkedAt: string;
  lastSuccessAt?: string;
  count: number;
  error?: string;
}

export interface SecurityFinding {
  id: string;
  cve?: string;
  product: string;
  component?: string;
  platform: SecurityPlatform;
  affected?: string;
  fixed?: string;
  action?: string;
  severity?: string;
  cvss?: number;
  exploited: boolean;
  date: string;
  url: string;
}

export interface EpssScore {
  cve: string;
  score: number;
  percentile: number;
  date: string;
}

export interface FinancialIndicator {
  value: string;
  reportedStatus: 'unknown' | 'inactive';
}

export interface FinancialNotice {
  id: string;
  title: string;
  source: string;
  url: string;
  published?: string;
  updated: string;
  observedAt: string;
  kind: 'incident' | 'regulatory' | 'phishing';
  indicators?: FinancialIndicator[];
  detailStatus?: 'ok' | 'failed';
}

export const FISAC_URL = 'https://www.fisac.tw/STIX_CASE/QueryStixCase/Query';
export const EPSS_URL = 'https://www.first.org/epss/';
const CVES = /CVE-\d{4}-\d{4,}/g;
const cves = (text: string) => [...new Set(text.match(CVES) ?? [])];
const cells = (row: string) => [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => cleanText(m[1]));
const day = (s: string) => s.match(/\b(20\d{2})[\/-](\d{2})[\/-](\d{2})\b/)?.slice(1).join('-');

/** Each release branch is kept separate: a Safari fix is never inferred to fix iOS. */
export function appleFindings(html: string, release: { name: string; date: string; url?: string }): SecurityFinding[] {
  if (!release.url) return [];
  const pieces = html.split(/(?=<h[23]\b)/i);
  return pieces.flatMap(piece => {
    const text = cleanText(piece);
    const ids = cves(text);
    if (!ids.length) return [];
    const component = cleanText(piece.match(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i)?.[1] ?? '').slice(0, 100);
    const affected = text.match(/Available for:\s*(.*?)(?=Impact:|Description:|CVE-)/i)?.[1]?.trim();
    return ids.map(cve => ({
      id: cve, cve, product: release.name, component: component || undefined,
      platform: /^iOS|^iPadOS/.test(release.name) ? 'iOS' as const : '跨平台' as const,
      affected: affected ? `更新適用裝置：${affected}；受影響系統版本依原文確認` : undefined,
      fixed: release.name, exploited: /may have been exploited/i.test(text), date: release.date, url: release.url!,
    }));
  });
}

/** Reads the bulletin's own component, affected AOSP versions and patch-level heading. */
export function androidFindings(html: string, bulletin: { url: string; published: string; exploited: string[] }): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  for (const match of html.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const before = html.slice(0, match.index);
    const headings = [...before.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi)].map(m => cleanText(m[1]));
    const patch = [...headings].reverse().find(s => /\d{4}-\d{2}-\d{2} security patch level/i.test(s))?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    const rows = [...match[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => cells(m[1]));
    const header = rows.find(r => r.some(c => /^CVE$/i.test(c)));
    if (!header) continue;
    const col = (pattern: RegExp) => header.findIndex(c => pattern.test(c));
    for (const row of rows) {
      const ids = cves(row[col(/^CVE$/i)] ?? '');
      for (const cve of ids) out.push({
        id: cve, cve, product: 'Android', platform: 'Android', component: headings.at(-1),
        affected: col(/AOSP versions/i) >= 0 ? row[col(/AOSP versions/i)] : undefined,
        fixed: patch ? `安全修補等級 ${patch}` : undefined,
        severity: col(/severity/i) >= 0 ? row[col(/severity/i)] : undefined,
        exploited: bulletin.exploited.includes(cve), date: bulletin.published, url: bulletin.url,
      });
    }
  }
  return out;
}

export function parseEpss(raw: unknown): EpssScore[] {
  const body = raw as { status?: unknown; data?: unknown } | null;
    if (body?.status !== 'OK' || !Array.isArray(body.data)) throw new Error('EPSS: unexpected response structure');
  return body.data.flatMap(value => {
    const row = value as Record<string, unknown> | null;
    const score = Number(row?.epss), percentile = Number(row?.percentile);
    if (typeof row?.cve !== 'string' || !/^CVE-\d{4}-\d{4,}$/.test(row.cve)
      || row.epss === null || row.epss === '' || row.percentile === null || row.percentile === ''
      || !Number.isFinite(score) || score < 0 || score > 1 || !Number.isFinite(percentile) || percentile < 0 || percentile > 1
      || typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return [];
    return [{ cve: row.cve, score, percentile, date: row.date }];
  });
}

/** Only public F-ISAC detail URLs; no pagination crawl and no indicator URLs are ever fetched. */
export function parseFinancialIndex(html: string, at: string): FinancialNotice[] {
  if (!/FISAC-|情資總覽/.test(cleanText(html))) throw new Error('F-ISAC: public intelligence list not found');
  const found = new Map<string, FinancialNotice>();
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const text = cleanText(row[1]);
    if (!/偽冒|釣魚|行動應用程式/.test(text)) continue;
    const link = [...row[1].matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
      .find(m => /\/STIX_CASE\/QueryStixCase\/Detail\?/i.test(m[1]));
    if (!link) continue;
    const url = safeUrl(new URL(link[1].replace(/&amp;/g, '&'), FISAC_URL).href);
    if (!url || new URL(url).origin !== new URL(FISAC_URL).origin) continue;
    const title = cleanText(link[2]);
    if (!title || title === '詳細') continue;
    const updated = day(text);
    if (!updated) continue;
    found.set(url, { id: `fisac:${url}`, title, source: 'F-ISAC', url, updated, observedAt: at, kind: 'phishing' });
  }
  return [...found.values()];
}

/** The source's public (TLP WHITE/CLEAR) update note only, not its historical IoC table. */
export function financialDetail(html: string, notice: FinancialNotice): FinancialNotice {
  const text = cleanText(html);
  if (!/TLP\s*[:：]?\s*\(?\s*(?:White|Clear)\s*\)?/i.test(text)) throw new Error('F-ISAC: public TLP marking not found');
  const note = text.split('更新說明')[1]?.split(/建議措施|IoC資料欄位/i)[0] ?? '';
  const indicators = [...note.matchAll(/hxxps?:\/\/[^\s<>「」（）()，、]+/gi)].slice(0, 60).map(m => ({
    value: m[0].replace(/\.(?!\])/g, '[.]').slice(0, 500),
    reportedStatus: /^\s*[（(][^）)]*連結已失效/.test(note.slice((m.index ?? 0) + m[0].length)) ? 'inactive' as const : 'unknown' as const,
  }));
  return { ...notice, published: day(text.split('發佈時間')[1] ?? '') ?? notice.published,
    updated: day(text.split('更新時間')[1] ?? '') ?? notice.updated, indicators };
}

const BANK_EVENT = /資安|個資|洩漏|外洩|盜轉|駭客|遭駭|入侵|行動銀行|網路銀行/;
/** A notice is evidence of that notice only; no inferred breach, recovery, or causal link to delisting. */
export function financialTimeline(news: DevNewsItem[], phishing: FinancialNotice[], previous: FinancialNotice[] = [], at: string): FinancialNotice[] {
  const notices = news.filter(n => /^(fsc|banking-news|banking-penalty):/.test(n.id) && n.category === 'security' && BANK_EVENT.test(n.title))
    .map(n => ({ id: `notice:${n.url}`, title: n.title, source: n.source, url: n.url, published: n.date, updated: n.date,
      observedAt: at, kind: /裁罰/.test(n.source) ? 'regulatory' as const : 'incident' as const }));
  const merged = new Map(previous.map(n => [n.id, n]));
  for (const item of [...notices, ...phishing]) {
    const old = merged.get(item.id);
    merged.set(item.id, { ...old, ...item, observedAt: old?.observedAt ?? item.observedAt });
  }
  return [...merged.values()].sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 500);
}

export function securityFindings(report: SecurityReport | null | undefined): SecurityFinding[] {
  if (!report) return [];
  const findings: SecurityFinding[] = [...report.apple.flatMap(r => r.findings ?? []), ...report.android.flatMap(b => b.findings ?? [])].map(f => ({ ...f }));
  for (const a of report.advisories) for (const range of a.ranges ?? []) findings.push({
    id: a.id, cve: a.cve, product: range.package, affected: range.vulnerable, fixed: range.patched,
    severity: a.severity, cvss: a.cvss, platform: a.platform, exploited: false, date: a.published, url: a.url,
  });
  for (const kev of report.kevArchive ?? report.exploited) {
    const matches = findings.filter(f => f.cve === kev.cve);
    if (matches.length) matches.forEach(f => { f.exploited = true; f.action = kev.requiredAction; });
    else findings.push({ id: kev.cve, cve: kev.cve, product: kev.product, platform: kev.platform, exploited: true, date: kev.dateAdded, url: kev.url, action: kev.requiredAction });
  }
  const severity = (s?: string) => ({ critical: 4, high: 3, moderate: 2, medium: 2, low: 1 }[s?.toLowerCase() ?? ''] ?? 0);
  const score = new Map((report.epss ?? []).map(e => [e.cve, e.score]));
  return findings.sort((a, b) => Number(b.exploited) - Number(a.exploited) || severity(b.severity) - severity(a.severity)
    || (score.get(b.cve ?? '') ?? -1) - (score.get(a.cve ?? '') ?? -1) || b.date.localeCompare(a.date));
}
