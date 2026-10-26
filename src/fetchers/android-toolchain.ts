import type { AndroidToolchain, ToolVersion } from '../types.js';
import { compareVersions } from '../versions.js';
import { settleSources } from './settle.js';
import { fetchText, NETWORK_TIMEOUT_MS as TIMEOUT_MS } from '../net.js';
import { calendarDate } from '../taipei-date.js';


const getText = (url: string) => fetchText(url, {}, TIMEOUT_MS, (status, where) => `${where} failed: ${status}`);

export interface StudioRelease {
  name: string;
  version: string;
  channel: string;
  date: string;
}

const toISODate = (date: string): string => calendarDate(date) ?? date;

async function fetchAndroidStudio(): Promise<Pick<AndroidToolchain, 'studioStable' | 'studioPreview'>> {
  const body = await getText('https://jb.gg/android-studio-releases-list.json');
  return parseStudioReleases((JSON.parse(body) as { content: { item: StudioRelease[] } }).content.item);
}

/** JetBrains' Android Studio list (newest first): the newest stable / patch, and the most mature newer preview if any */
export function parseStudioReleases(items: StudioRelease[]): Pick<AndroidToolchain, 'studioStable' | 'studioPreview'> {
  const toTool = (r: StudioRelease): ToolVersion => ({
    name: r.name,
    version: r.version,
    channel: r.channel,
    releaseDate: toISODate(r.date),
    url: 'https://developer.android.com/studio/releases',
  });

  // Newest first, as the list comes (sorted here too, by version, so an oldest-first list reads the same);
  // "Patch" releases are stable too
  items = [...items].sort((a, b) => compareVersions(b.version, a.version));
  const stableIndex = items.findIndex(r => r.channel === 'Release' || r.channel === 'Patch');
  // Of the previews newer than it, the one closest to release (an RC of the next version before a Canary of the
  // one after: the RC is what developers test against next), the newest of that channel
  const newer = items.slice(0, stableIndex === -1 ? items.length : stableIndex);
  const preview = ['RC', 'Beta', 'Canary'].map(channel => newer.find(r => r.channel === channel)).find(Boolean);

  return {
    studioStable: stableIndex === -1 ? undefined : toTool(items[stableIndex]),
    studioPreview: preview ? toTool(preview) : undefined,
  };
}

export function mavenVersions(xml: string): string[] {
  return [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);
}

const isStable = (v: string) => /^\d+(\.\d+)*$/.test(v);

export function latestStable(versions: string[]): string | undefined {
  return versions.filter(isStable).sort(compareVersions).at(-1);
}

async function fetchAgp(): Promise<Pick<AndroidToolchain, 'agpStable' | 'agpPreview'>> {
  return parseAgpMetadata(await getText('https://dl.google.com/dl/android/maven2/com/android/tools/build/gradle/maven-metadata.xml'));
}

/**
 * Google Maven metadata for AGP: newest stable, plus the preview closest to release that is ahead of it (an RC of
 * the next version before an alpha of the one after, as for Android Studio: the RC is what pairs with the Studio
 * RC developers test next), the newest of that stage
 */
export function parseAgpMetadata(xml: string): Pick<AndroidToolchain, 'agpStable' | 'agpPreview'> {
  const versions = mavenVersions(xml);
  const stable = latestStable(versions);
  const url = 'https://developer.android.com/build/releases/gradle-plugin';
  const ahead = versions.filter(v => !isStable(v) && (!stable || compareVersions(v.split('-')[0], stable) > 0));
  const newestOf = (stage: RegExp) => ahead.filter(v => stage.test(v)).sort((a, b) => compareVersions(a.split('-')[0], b.split('-')[0]) || a.localeCompare(b, 'en', { numeric: true })).at(-1);
  const preview = newestOf(/-rc\d*$/i) ?? newestOf(/-beta\d*$/i) ?? newestOf(/-alpha\d*$/i) ?? xml.match(/<latest>([^<]+)<\/latest>/)?.[1];

  return {
    agpStable: stable ? { name: 'Android Gradle Plugin', version: stable, url } : undefined,
    agpPreview: preview && !isStable(preview) && (!stable || compareVersions(preview.split('-')[0], stable) > 0)
      ? { name: 'Android Gradle Plugin', version: preview, channel: 'Preview', url }
      : undefined,
  };
}

async function fetchGradle(): Promise<ToolVersion> {
  return parseGradleCurrent(JSON.parse(await getText('https://services.gradle.org/versions/current')) as { version: string; buildTime: string });
}

/** services.gradle.org/versions/current; buildTime is "20261001120000+0000" (an ISO time is read too) */
export function parseGradleCurrent(data: { version: string; buildTime: string }): ToolVersion {
  const t = String(data.buildTime ?? '');
  const day = t.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  if (!/^\d+(?:\.\d+)+(?:-[\w.]+)?$/.test(String(data.version ?? ''))) throw new Error(`Gradle version "${data.version}" doesn't look like a version`);
  return {
    name: 'Gradle',
    version: data.version,
    releaseDate: day ? `${day[1]}-${day[2]}-${day[3]}` : undefined,
    url: 'https://gradle.org/releases/',
  };
}

async function fetchKotlin(): Promise<ToolVersion> {
  const xml = await getText('https://repo1.maven.org/maven2/org/jetbrains/kotlin/kotlin-stdlib/maven-metadata.xml');
  const stable = latestStable(mavenVersions(xml));
  if (!stable) throw new Error('No stable Kotlin version found');
  return { name: 'Kotlin', version: stable, url: 'https://kotlinlang.org/docs/releases.html' };
}

/** The BOM-to-library mapping page lists every BOM version in its picker (Maven has them too, but dl.google.com's robots.txt disallows crawlers) */
export const COMPOSE_BOM_PAGE = 'https://developer.android.com/develop/ui/compose/bom/bom-mapping?hl=en';

async function fetchComposeBom(): Promise<ToolVersion> {
  return parseComposeBomPage(await getText(COMPOSE_BOM_PAGE));
}

/** Newest BOM in the page's version picker; versions are dates (2026.09.00), so the numeric compare applies */
export function parseComposeBomPage(html: string): ToolVersion {
  // The first picker whose options are BOM versions
  const versions = (html.match(/<select[^>]*>[\s\S]*?<\/select>/g) ?? [])
    .map(picker => [...picker.matchAll(/<option[^>]*>\s*(\d{4}\.\d{2}\.\d{2})\s*<\/option>/g)].map(m => m[1]))
    .find(list => list.length) ?? [];
  const newest = versions.sort(compareVersions).at(-1);
  if (!newest) throw new Error('No Compose BOM version found on the BOM mapping page');
  return { name: 'Compose BOM', version: newest, url: 'https://developer.android.com/develop/ui/compose/bom/bom-mapping' };
}

async function fetchSdkRepository(): Promise<Pick<AndroidToolchain, 'sdkPlatform' | 'buildTools'>> {
  return parseSdkRepository(await getText('https://dl.google.com/android/repository/repository2-3.xml'));
}

/** Newest stable SDK platform (previews carry a codename) and newest build-tools in repository2-3.xml */
export function parseSdkRepository(xml: string): Pick<AndroidToolchain, 'sdkPlatform' | 'buildTools'> {
  const platforms: string[] = [];
  const buildTools: string[] = [];
  for (const m of xml.matchAll(/<remotePackage path="([^"]+)">([\s\S]*?)<\/remotePackage>/g)) {
    const [, path, body] = m;
    const platform = path.match(/^platforms;android-(\d+(?:\.\d+)?)$/);
    // Stable platforms have no codename (previews use e.g. "CANARY" or a dessert name)
    const codename = body.match(/<codename>([^<]*)<\/codename>/)?.[1];
    if (platform && !codename) platforms.push(platform[1]);

    const tools = path.match(/^build-tools;([\d.]+)$/);
    if (tools) buildTools.push(tools[1]);
  }

  const sdk = platforms.sort(compareVersions).at(-1);
  const bt = buildTools.sort(compareVersions).at(-1);
  return {
    sdkPlatform: sdk ? { name: 'SDK Platform', version: `android-${sdk}`, url: 'https://developer.android.com/tools/releases/platforms' } : undefined,
    buildTools: bt ? { name: 'Build Tools', version: bt, url: 'https://developer.android.com/tools/releases/build-tools' } : undefined,
  };
}

export type ToolchainPart = Partial<AndroidToolchain>;

export const ANDROID_TOOLCHAIN_SOURCES: ReadonlyArray<readonly [string, () => Promise<ToolchainPart>]> = [
  ['Android Studio', fetchAndroidStudio],
  ['AGP', fetchAgp],
  ['Gradle', () => fetchGradle().then(gradle => ({ gradle }))],
  ['Kotlin', () => fetchKotlin().then(kotlin => ({ kotlin }))],
  ['SDK repository', fetchSdkRepository],
  ['Compose BOM', () => fetchComposeBom().then(composeBom => ({ composeBom }))],
];

/** Partial results are kept; throws only when no upstream produced any tool version */
export async function fetchAndroidToolchain(sources = ANDROID_TOOLCHAIN_SOURCES): Promise<AndroidToolchain> {
  const { values } = await settleSources('Android toolchain', sources, part => Object.values(part).some(v => v !== undefined));
  return Object.assign({}, ...values.values()) as AndroidToolchain;
}
