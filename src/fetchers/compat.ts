import { fetchHtml, parseTables } from './html-table.js';
import type { AndroidCompat, XcodeSupportRow } from '../types.js';

export const AGP_COMPAT_URL = 'https://developer.android.com/build/releases/about-agp?hl=en';
export const AGP_RELEASE_URL = 'https://developer.android.com/build/releases/gradle-plugin?hl=en';
export const KOTLIN_COMPAT_URL = 'https://kotlinlang.org/docs/gradle-configure-project.html';
export const XCODE_SUPPORT_URL = 'https://developer.apple.com/support/xcode/';

/** "7.6.3–9.7.0" → ["7.6.3", "9.7.0"]; a single version is both bounds */
function range(text: string): [string, string] {
  const [min, max] = text.replace(/\*/g, '').split(/\s*[–-]\s*/);
  return [min.trim(), (max ?? min).trim()];
}

/** Parses the AGP ↔ Gradle, Android Studio ↔ AGP and API level tables from the about-agp page */
export function parseAgpTables(html: string): Pick<AndroidCompat, 'agpGradle' | 'studioAgp' | 'apiLevels'> {
  const tables = parseTables(html);

  const gradleTable = tables.find(t => /minimum required gradle version/i.test(t.rows[0]?.join(' ') ?? ''));
  const studioIndex = tables.findIndex(t => /required agp version/i.test(t.rows[0]?.join(' ') ?? ''));
  const studioTable = tables[studioIndex];
  // The API level table has no header row; it's introduced by "The minimum versions of Android Studio and AGP"
  const apiTable = tables.find(t => /minimum versions of Android Studio and AGP/i.test(t.context));

  if (!gradleTable || !studioTable) {
    throw new Error('AGP compatibility tables not found');
  }

  const result = {
    agpGradle: gradleTable.rows.slice(1)
      .filter(r => r.length >= 2)
      .map(([agp, gradle]) => ({ agp, minGradle: gradle })),
    // Cells read "Rabbit 1 | 2026.2.1" and "7.1-9.4"; older versions continue in the next, header-less table
    studioAgp: [...studioTable.rows.slice(1), ...(tables[studioIndex + 1]?.rows ?? [])]
      .filter(r => r.length === 2 && /\|/.test(r[0]) && /^[\d.]+\s*-\s*[\d.]+$/.test(r[1]))
      .map(([studio, agp]) => ({ studio: studio.replace(/\s*\|\s*/, ' · '), agp: range(agp) })),
    apiLevels: (apiTable?.rows ?? [])
      .filter(r => r.length >= 3 && /^\d+(\.\d+)?$/.test(r[0]))
      .map(([api, studio, agp]) => ({ api, minStudio: studio.replace(/\s*\|\s*/, ' · '), minAgp: agp })),
  };
  if (!result.agpGradle.length || !result.studioAgp.length) {
    throw new Error('AGP compatibility tables parsed empty');
  }
  return result;
}

/** Parses the "current release" requirements (JDK, Gradle, build tools, max API) from the gradle-plugin page */
export function parseAgpRequirements(html: string): AndroidCompat['current'] {
  const tables = parseTables(html);
  const reqTable = tables.find(t => t.rows.some(r => r[0] === 'JDK') && t.rows.some(r => r[0] === 'Gradle'));
  const text = tables[0]?.context ?? '';
  const maxApi = text.match(/maximum API level that Android Gradle plugin ([\d.]+) supports is API level (\d+)/i);
  if (!reqTable || !maxApi) {
    throw new Error('AGP current requirements not found');
  }
  const cell = (name: string) => reqTable.rows.find(r => r[0] === name)?.[1];

  return {
    agp: maxApi[1],
    maxApi: maxApi[2],
    minGradle: cell('Gradle'),
    minBuildTools: cell('SDK Build Tools'),
    jdk: cell('JDK'),
  };
}

/** Parses the Kotlin Gradle plugin ↔ Gradle ↔ AGP compatibility table */
export function parseKotlinCompat(html: string): AndroidCompat['kotlin'] {
  const tables = parseTables(html);
  const kgp = tables.find(t => /KGP version/i.test(t.rows[0]?.join(' ') ?? ''));
  if (!kgp) throw new Error('Kotlin Gradle plugin compatibility table not found');
  const rows = kgp.rows.slice(1)
    .filter(r => r.length >= 3)
    .map(([kotlin, gradle, agp]) => ({ kotlin: kotlin.replace(/\s*–\s*/, '–'), gradle: range(gradle), agp: range(agp) }));
  if (!rows.length) throw new Error('Kotlin Gradle plugin compatibility table parsed empty');
  return rows;
}

export async function fetchAndroidCompat(): Promise<AndroidCompat> {
  const [agpHtml, releaseHtml, kotlinHtml] = await Promise.all([
    fetchHtml(AGP_COMPAT_URL),
    fetchHtml(AGP_RELEASE_URL),
    fetchHtml(KOTLIN_COMPAT_URL),
  ]);
  return {
    ...parseAgpTables(agpHtml),
    current: parseAgpRequirements(releaseHtml),
    kotlin: parseKotlinCompat(kotlinHtml),
  };
}

/** Apple's "Latest Xcode versions" table: macOS, SDKs, deployment targets, device support, Swift */
export async function fetchXcodeSupport(): Promise<XcodeSupportRow[]> {
  return parseXcodeSupport(await fetchHtml(XCODE_SUPPORT_URL));
}

export function parseXcodeSupport(html: string): XcodeSupportRow[] {
  const tables = parseTables(html);
  const latest = tables.find(t => /Deployment Targets/i.test(t.rows[0]?.join(' ') ?? ''));
  if (!latest) throw new Error('Xcode support table not found');

  const pick = (cell: string, platform: string) =>
    cell.match(new RegExp(`(?:^|\\s)${platform}\\s+([\\d.]+(?:\\s*[–-]\\s*[\\d.]+)?(?:\\s+or later)?)`))?.[1];

  const rows = latest.rows.slice(1).map(([xcode, macOS, sdks, targets, devices, simulator, swift]) => ({
    xcode: xcode.replace(/^Xcode\s+/, ''),
    macOS,
    iosSdk: pick(sdks ?? '', 'iOS'),
    deploymentiOS: pick(targets ?? '', 'iOS')?.replace(/\s*[–-]\s*/, '–'),
    deviceiOS: pick(devices ?? '', 'iOS'),
    simulatoriOS: pick(simulator ?? '', 'iOS'),
    swift: swift?.match(/Swift\s+([\d.]+)/)?.[1],
  }));
  if (!rows.some(r => r.iosSdk)) throw new Error('Xcode support table parsed without any iOS SDK');
  return rows;
}
