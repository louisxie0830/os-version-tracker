import type { SourceInfo } from './types.js';

/** Below this share of healthy sources the static build keeps the previous deployment instead */
export const MIN_HEALTHY_SOURCES = 0.6;

/** Without these the page has no OS versions at all, so a build missing either is never published */
export const CRITICAL_SOURCES = ['ios', 'android'] as const;

export interface PublishDecision {
  publish: boolean;
  healthy: number;
  total: number;
  failed: string[];
  reason?: string;
}

export function publishDecision(sources: Record<string, SourceInfo>): PublishDecision {
  const entries = Object.entries(sources);
  const failed = entries.filter(([, s]) => !s.ok).map(([k]) => k);
  const healthy = entries.length - failed.length;
  const base = { healthy, total: entries.length, failed };

  if (!entries.length) return { ...base, publish: false, reason: 'no sources were fetched' };
  const missingCritical = CRITICAL_SOURCES.filter(k => !sources[k]?.ok);
  if (missingCritical.length) return { ...base, publish: false, reason: `critical source failed: ${missingCritical.join(', ')}` };
  if (healthy / entries.length < MIN_HEALTHY_SOURCES) {
    return { ...base, publish: false, reason: `only ${healthy}/${entries.length} sources succeeded` };
  }
  return { ...base, publish: true };
}
