import type { AndroidToolchain, ToolVersion } from '../types.js';
import { compareVersions } from './ios-toolchain.js';
import { settleSources } from './settle.js';
import { fetchText, NETWORK_TIMEOUT_MS as TIMEOUT_MS } from '../net.js';


const getText = (url: string) => fetchText(url, {}, TIMEOUT_MS, (status, where) => `${where} failed: ${status}`);

export interface StudioRelease {
  name: string;
  version: string;
  channel: string;
  date: string;
}

function toISODate(date: string): string {
  // "October 1, 2026" parses as local midnight; format with local getters to avoid a UTC day shift
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function fetchAndroidStudio(): Promise<Pick<AndroidToolchain, 'studioStable' | 'studioPreview'>> {
  const body = await getText('https://jb.gg/android-studio-releases-list.json');
  return parseStudioReleases((JSON.parse(body) as { content: { item: StudioRelease[] } }).content.item);
}

/** JetBrains' Android Studio list (newest first): the newest stable / patch, and a newer preview if any */
export function parseStudioReleases(items: StudioRelease[]): Pick<AndroidToolchain, 'studioStable' | 'studioPreview'> {
  const toTool = (r: StudioRelease): ToolVersion => ({
    name: r.name,
    version: r.version,
    channel: r.channel,
    releaseDate: toISODate(r.date),
    url: 'https://developer.android.com/studio/releases',
  });

  // List is newest first; "Patch" releases are stable too
  const stableIndex = items.findIndex(r => r.channel === 'Release' || r.channel === 'Patch');
  const preview = items.slice(0, stableIndex === -1 ? items.length : stableIndex)
    .find(r => ['Beta', 'RC', 'Canary'].includes(r.channel));

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

/** Google Maven metadata for AGP: newest stable, plus the <latest> preview when it's ahead of it */
export function parseAgpMetadata(xml: string): Pick<AndroidToolchain, 'agpStable' | 'agpPreview'> {
  const versions = mavenVersions(xml);
  const stable = latestStable(versions);
  const latest = xml.match(/<latest>([^<]+)<\/latest>/)?.[1];
  const url = 'https://developer.android.com/build/releases/gradle-plugin';

  return {
    agpStable: stable ? { name: 'Android Gradle Plugin', version: stable, url } : undefined,
    agpPreview: latest && !isStable(latest) && (!stable || compareVersions(latest.split('-')[0], stable) > 0)
      ? { name: 'Android Gradle Plugin', version: latest, channel: 'Preview', url }
      : undefined,
  };
}

async function fetchGradle(): Promise<ToolVersion> {
  return parseGradleCurrent(JSON.parse(await getText('https://services.gradle.org/versions/current')) as { version: string; buildTime: string });
}

/** services.gradle.org/versions/current; buildTime is "20261001120000+0000" */
export function parseGradleCurrent(data: { version: string; buildTime: string }): ToolVersion {
  const t = data.buildTime;
  return {
    name: 'Gradle',
    version: data.version,
    releaseDate: `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`,
    url: 'https://gradle.org/releases/',
  };
}

async function fetchKotlin(): Promise<ToolVersion> {
  const xml = await getText('https://repo1.maven.org/maven2/org/jetbrains/kotlin/kotlin-stdlib/maven-metadata.xml');
  const stable = latestStable(mavenVersions(xml));
  if (!stable) throw new Error('No stable Kotlin version found');
  return { name: 'Kotlin', version: stable, url: 'https://kotlinlang.org/docs/releases.html' };
}

async function fetchComposeBom(): Promise<ToolVersion> {
  const xml = await getText('https://dl.google.com/dl/android/maven2/androidx/compose/compose-bom/maven-metadata.xml');
  // BOM versions are dates (2026.10.00), so the stable filter + numeric compare still applies
  const stable = latestStable(mavenVersions(xml));
  if (!stable) throw new Error('No stable Compose BOM found');
  return { name: 'Compose BOM', version: stable, url: 'https://developer.android.com/develop/ui/compose/bom/bom-mapping' };
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
