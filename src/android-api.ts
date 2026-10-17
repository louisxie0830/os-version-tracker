/**
 * Android version → API level, and which major versions exist yet, by rule rather than by a table someone
 * has to extend every year (a table that stops at 17 would file Android 18 under "other").
 */

// Before 13 the numbering is irregular (8.1 is 27, 12L is 32); these never change
const IRREGULAR: Record<string, number> = {
  '4': 19, '4.4': 19, '5.0': 21, '5.1': 22, '6.0': 23, '7.0': 24, '7.1': 25, '8.0': 26, '8.1': 27, '9': 28, '10': 29, '11': 30, '12': 31,
};

/** "8.0" / "8" → 26, "14" → 34; from Android 13 on, each major is API major + 20 (13 → 33 … 17 → 37) */
export function androidApiLevel(version: string): number | undefined {
  const v = version.trim().replace(/^Android\s*/i, '');
  const major = Number(v.match(/^(\d+)/)?.[1]);
  if (!Number.isFinite(major)) return undefined;
  if (major >= 13) return major + 20;
  return IRREGULAR[v] ?? IRREGULAR[v.replace(/\.0$/, '')] ?? IRREGULAR[`${major}.0`] ?? IRREGULAR[String(major)];
}

/**
 * The newest Android major that can exist by `now`: one a year (Android 17 shipped in 2026), plus the
 * next year's betas. Anything above it in a third-party label is noise (e.g. StatCounter's "Android 26").
 */
export function newestPossibleAndroidMajor(now = new Date()): number {
  return now.getUTCFullYear() - 2009 + 1;
}
