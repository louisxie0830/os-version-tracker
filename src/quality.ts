import type { SourceKey } from './fetch-all.js';
import type { TaiwanBankApp, TaiwanBankAppEntry } from './fetchers/tw-banks.js';
import { checkCountNotDropped } from './history.js';

/**
 * Data completeness checks. A source can "succeed" and still come back with holes: a store page changes
 * its format and one field goes missing for some apps, or a feed parser finds a fraction of the usual items.
 * Nothing throws in those cases, so the source alert never fires; these checks catch them instead. Missing
 * fields are still published (the data is usually mostly right); a list that shrank is replaced by the
 * source's last good result where there is one (fetch-all.ts). Either way the problems go to their own alert.
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
    const store = platform === 'ios' ? 'App Store' : 'Google Play';
    if (listed.length && missing.length) {
      problems.push(`${store} 沒有抓到 ${missing.length} 個 App：${missing.map(i => idOf(i, platform)).join('、')}`);
    }
    // The whole store missing while the other one worked: the source still "succeeded", so this is the only alert
    const other = platform === 'ios' ? 'android' : 'ios';
    if (expected.length && !listed.length && apps.some(a => a?.[other])) {
      problems.push(`${store} 一個 App 都沒有抓到（${expected.length} 個應有資料；另一個商店正常）`);
    }
    for (const field of BANK_FIELDS.filter(f => f.startsWith(`${platform}.`))) {
      const key = field.split('.')[1];
      const without = listed.filter(i => !(apps[i][platform] as Record<string, unknown> | undefined)?.[key]);
      if (without.length && (listed.length - without.length) / listed.length >= FIELD_PRESENT_RATIO) {
        problems.push(`${field} 有 ${without.length}/${listed.length} 個 App 缺值：${without.map(i => idOf(i, platform)).join('、')}`);
      }
      // Missing for every app at once: a renamed field upstream (android.version is optional by nature)
      if (listed.length >= 3 && without.length === listed.length) problems.push(`${field} 所有 App 都缺值（${listed.length} 個），來源格式可能改了`);
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
  const result = countProblems(input.ok, input.counts);
  if (input.ok('twBanks')) result.set('twBanks', [...bankFieldGaps(input.bankEntries, input.banks), ...(result.get('twBanks') ?? [])]);
  return result;
}

/**
 * The item-count checks alone, for the sources that succeeded: a source with a message here returned far
 * fewer items than usual (the refresh then shows its last good result instead, when it has one)
 */
export function countProblems(
  ok: (key: SourceKey) => boolean,
  counts: Partial<Record<SourceKey, Record<string, number>>>,
): Map<SourceKey, string[]> {
  const result = new Map<SourceKey, string[]>();
  for (const [source, lists] of Object.entries(counts) as Array<[SourceKey, Record<string, number>]>) {
    if (!ok(source)) continue;
    result.set(source, Object.entries(lists).flatMap(([name, count]) => {
      const check = checkCountNotDropped(name, count);
      return check.ok ? [] : [check.message];
    }));
  }
  return result;
}
