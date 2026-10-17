import type { SourceKey } from './fetch-all.js';
import type { TaiwanBankApp, TaiwanBankAppEntry } from './fetchers/tw-banks.js';
import { checkCountNotDropped } from './history.js';

/**
 * Data completeness checks. A source can "succeed" and still come back with holes: a store page changes
 * its format and one field goes missing for some apps, or a feed parser finds a fraction of the usual items.
 * Nothing throws in those cases, so the source alert never fires; these checks catch them instead. The data
 * is still published (it's usually mostly right); the problems go to their own alert.
 */

/** A field most apps have is a field every app should have */
const FIELD_PRESENT_RATIO = 0.8;

type BankField = 'ios.minOs' | 'ios.version' | 'ios.updated' | 'android.minOs' | 'android.updated' | 'android.targetSdk';
// android.version is left out: apps with per-device builds have no single version
const BANK_FIELDS: BankField[] = ['ios.minOs', 'ios.version', 'ios.updated', 'android.minOs', 'android.updated', 'android.targetSdk'];

/**
 * Bank apps missing a store listing they should have (the entry has an App Store id / Play package), or
 * missing a field that at least 80% of the other apps have. Apps are named by store id, not bank name.
 */
export function bankFieldGaps(entries: readonly TaiwanBankAppEntry[], apps: readonly TaiwanBankApp[]): string[] {
  const problems: string[] = [];
  const idOf = (i: number, platform: 'ios' | 'android') => (platform === 'ios' ? `id${entries[i]?.appStoreId}` : entries[i]?.playPackage ?? '?');
  for (const platform of ['ios', 'android'] as const) {
    const expected = apps.map((_, i) => i).filter(i => (platform === 'ios' ? entries[i]?.appStoreId : entries[i]?.playPackage));
    const listed = expected.filter(i => apps[i]?.[platform]);
    const missing = expected.filter(i => !apps[i]?.[platform]);
    // Some listings found means the store worked; all missing is the source failure the source alert covers
    if (listed.length && missing.length) {
      problems.push(`${platform === 'ios' ? 'App Store' : 'Google Play'} 沒有抓到 ${missing.length} 個 App：${missing.map(i => idOf(i, platform)).join('、')}`);
    }
    for (const field of BANK_FIELDS.filter(f => f.startsWith(`${platform}.`))) {
      const key = field.split('.')[1];
      const without = listed.filter(i => !(apps[i][platform] as Record<string, unknown> | undefined)?.[key]);
      if (without.length && (listed.length - without.length) / listed.length >= FIELD_PRESENT_RATIO) {
        problems.push(`${field} 有 ${without.length}/${listed.length} 個 App 缺值：${without.map(i => idOf(i, platform)).join('、')}`);
      }
    }
  }
  return problems;
}

/**
 * Every check for this refresh, given only the sources that succeeded (a failed source is already alerted,
 * and its empty fallback would look like a drop). Returns the sources that were checked, each with its
 * problems (an empty list means it's fine, so a previous alert can close).
 */
export function dataQualityProblems(input: {
  ok: (key: SourceKey) => boolean;
  bankEntries: readonly TaiwanBankAppEntry[];
  banks: readonly TaiwanBankApp[];
  counts: Partial<Record<SourceKey, Record<string, number>>>;
}): Map<SourceKey, string[]> {
  const result = new Map<SourceKey, string[]>();
  const push = (source: SourceKey, messages: string[]) => result.set(source, [...(result.get(source) ?? []), ...messages]);
  if (input.ok('twBanks')) push('twBanks', bankFieldGaps(input.bankEntries, input.banks));
  for (const [source, lists] of Object.entries(input.counts) as Array<[SourceKey, Record<string, number>]>) {
    if (!input.ok(source)) continue;
    push(source, Object.entries(lists).flatMap(([name, count]) => {
      const check = checkCountNotDropped(name, count);
      return check.ok ? [] : [check.message];
    }));
  }
  return result;
}
