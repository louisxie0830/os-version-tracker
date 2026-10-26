/**
 * Compares dotted versions numerically ("27.10" > "27.9"; a missing part counts as 0, so "27" equals "27.0").
 * Each part is read by its leading digits, so "1-beta" doesn't turn into NaN and scramble a sort; when the
 * numbers are equal, a pre-release ("9.5.0-alpha01", "27.2 beta") comes before the release.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.trim().split(/[-\s]/)[0].split('.').map(p => Number.parseInt(p, 10) || 0);
  const va = parts(a);
  const vb = parts(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const diff = (va[i] ?? 0) - (vb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  const pre = (v: string) => (/[-\s]/.test(v.trim()) ? 1 : 0);
  return pre(b) - pre(a);
}
