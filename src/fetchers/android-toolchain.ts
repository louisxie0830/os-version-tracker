import type { AndroidToolchain, ToolVersion } from '../types.js';
import { compareVersions } from './ios-toolchain.js';

const TIMEOUT_MS = 15_000;

async function getText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'os-version-tracker/1.0' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`${url} failed: ${res.status}`);
  }
  return res.text();
}

interface StudioRelease {
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
  const items = (JSON.parse(body) as { content: { item: StudioRelease[] } }).content.item;

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

function mavenVersions(xml: string): string[] {
  return [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);
}

const isStable = (v: string) => /^\d+(\.\d+)*$/.test(v);

function latestStable(versions: string[]): string | undefined {
  return versions.filter(isStable).sort(compareVersions).at(-1);
}

async function fetchAgp(): Promise<Pick<AndroidToolchain, 'agpStable' | 'agpPreview'>> {
  const xml = await getText('https://dl.google.com/dl/android/maven2/com/android/tools/build/gradle/maven-metadata.xml');
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
  const body = await getText('https://services.gradle.org/versions/current');
  const data = JSON.parse(body) as { version: string; buildTime: string };
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
  const xml = await getText('https://dl.google.com/android/repository/repository2-3.xml');

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

export async function fetchAndroidToolchain(): Promise<AndroidToolchain> {
  const sources = [
    ['Android Studio', fetchAndroidStudio()],
    ['AGP', fetchAgp()],
    ['Gradle', fetchGradle().then(gradle => ({ gradle }))],
    ['Kotlin', fetchKotlin().then(kotlin => ({ kotlin }))],
    ['SDK repository', fetchSdkRepository()],
    ['Compose BOM', fetchComposeBom().then(composeBom => ({ composeBom }))],
  ] as const;

  const results = await Promise.allSettled(sources.map(([, p]) => p));
  const toolchain: AndroidToolchain = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      Object.assign(toolchain, r.value);
    } else {
      console.warn(`[Android toolchain] ${sources[i][0]} failed (${(r.reason as Error).message})`);
    }
  });
  return toolchain;
}
