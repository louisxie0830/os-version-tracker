import { fetchJson, fetchText, githubHeaders, NETWORK_TIMEOUT_MS } from '../net.js';
import { settleSources } from './settle.js';
import { sharedDownload } from './feed.js';
import { cleanText } from './html-table.js';
import { dayOf } from '../taipei-date.js';

/**
 * React Native and Flutter releases, the cross-platform counterparts of the Cordova section:
 * - React Native: GitHub releases of react/react-native. For each minor's first stable release the
 *   release notes are only counted by section (Breaking / Deprecated / Security), never republished.
 * - Flutter: the official release index the Flutter tool itself uses (stable channel, macOS archive list).
 */

export interface FrameworkRelease {
  version: string;
  date: string; // YYYY-MM-DD
  url: string;
  /** Items the release notes list under "Breaking", "Deprecated" and "Security" (React Native .0 releases) */
  breaking?: number;
  deprecated?: number;
  security?: number;
  /** Flutter: the bundled Dart SDK */
  dart?: string;
}

export interface FrameworkInfo {
  name: 'React Native' | 'Flutter';
  latest: FrameworkRelease;
  /** Latest patch of each recent minor line, newest first (latest included) */
  recentMinors: FrameworkRelease[];
  releaseNotesUrl: string;
  breakingChangesUrl: string;
  /**
   * Flutter: the breaking changes of its recent minor lines, each a title with its migration guide (absent when
   * the list couldn't be read, and for React Native, whose notes are counted, not republished)
   */
  breakingChanges?: Array<{ minor: string; changes: Array<{ title: string; url: string }> }>;
}

export interface Frameworks {
  reactNative?: FrameworkInfo;
  flutter?: FrameworkInfo;
}

const MINORS = 4;
const RN_RELEASES = 'https://api.github.com/repos/react/react-native/releases?per_page=60';
export const FLUTTER_RELEASES = 'https://storage.googleapis.com/flutter_infra_release/releases/releases_macos.json';

/** "0.88.0" → [0, 88, 0]; anything else → null */
const parts = (v: string) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : null);
const minorOf = (v: string) => v.split('.').slice(0, 2).join('.');
const newerFirst = (a: string, b: string) => {
  const [x, y] = [parts(a)!, parts(b)!];
  return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
};

/** Bullet items under a "### <heading>" section of release notes, up to the next heading of that level or higher */
export function countSection(body: string, heading: RegExp): number {
  const lines = body.split(/\r?\n/);
  let count = 0;
  let inside = false;
  for (const line of lines) {
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      inside = heading.test(h[2].trim());
      continue;
    }
    if (inside && /^\s*[-*]\s+\S/.test(line)) count++;
  }
  return count;
}

interface GithubRelease { tag_name: string; prerelease: boolean; draft: boolean; published_at: string; html_url: string; body?: string | null }

export function parseReactNativeReleases(releases: GithubRelease[]): FrameworkInfo {
  const stable = releases
    .filter(r => !r.prerelease && !r.draft && /^v\d+\.\d+\.\d+$/.test(r.tag_name))
    .map(r => ({ ...r, version: r.tag_name.slice(1) }))
    .sort((a, b) => newerFirst(a.version, b.version));
  if (!stable.length) throw new Error('No stable React Native release');
  const toRelease = (r: (typeof stable)[number]): FrameworkRelease => ({ version: r.version, date: dayOf(r.published_at), url: r.html_url });
  const minors = [...new Set(stable.map(r => minorOf(r.version)))].slice(0, MINORS);
  const recentMinors = minors.map(minor => {
    const latestPatch = stable.find(r => minorOf(r.version) === minor)!;
    // Breaking changes are listed in the minor's first stable release (x.y.0)
    const first = stable.find(r => r.version === `${minor}.0`);
    const body = first?.body ?? '';
    return {
      ...toRelease(latestPatch),
      ...(first ? {
        breaking: countSection(body, /^breaking/i),
        deprecated: countSection(body, /^deprecated/i),
        security: countSection(body, /^security/i),
      } : {}),
    };
  });
  return {
    name: 'React Native',
    latest: recentMinors[0],
    recentMinors,
    releaseNotesUrl: 'https://github.com/react/react-native/releases',
    breakingChangesUrl: 'https://reactnative.dev/blog',
  };
}

export interface FlutterIndex {
  current_release?: { stable?: string };
  releases?: Array<{ hash: string; channel: string; version: string; release_date: string; dart_sdk_version?: string }>;
}

export function parseFlutterReleases(index: FlutterIndex): FrameworkInfo {
  const stable = (index.releases ?? []).filter(r => r.channel === 'stable' && parts(r.version));
  // The index lists each release once per CPU architecture
  const unique = [...new Map(stable.map(r => [r.version, r])).values()].sort((a, b) => newerFirst(a.version, b.version));
  const current = unique.find(r => r.hash === index.current_release?.stable) ?? unique[0];
  if (!current) throw new Error('No stable Flutter release');
  const toRelease = (r: (typeof unique)[number]): FrameworkRelease => ({
    version: r.version,
    date: dayOf(r.release_date),
    url: `https://github.com/flutter/flutter/releases/tag/${r.version}`,
    ...(r.dart_sdk_version ? { dart: r.dart_sdk_version } : {}),
  });
  const minors = [...new Set(unique.filter(r => newerFirst(r.version, current.version) >= 0).map(r => minorOf(r.version)))].slice(0, MINORS);
  return {
    name: 'Flutter',
    latest: toRelease(current),
    recentMinors: minors.map(minor => toRelease(unique.find(r => minorOf(r.version) === minor && newerFirst(r.version, current.version) >= 0)!)),
    releaseNotesUrl: 'https://docs.flutter.dev/release/release-notes',
    breakingChangesUrl: 'https://docs.flutter.dev/release/breaking-changes',
  };
}

const json = <T>(url: string, headers: Record<string, string> = {}) => fetchJson<T>(url, { headers }, NETWORK_TIMEOUT_MS, status => `HTTP ${status}`);

/** Flutter's release index, downloaded once per refresh */
export const flutterIndex = () => sharedDownload('json flutter-releases', () => json<FlutterIndex>(FLUTTER_RELEASES));

export const FLUTTER_BREAKING_URL = 'https://docs.flutter.dev/release/breaking-changes';

/**
 * The breaking changes listed under "Released in Flutter <minor>" for the given minors: each change's title and
 * its migration guide (titles only; the guides stay on Flutter's site)
 */
export function parseFlutterBreaking(html: string, minors: string[]): NonNullable<FrameworkInfo['breakingChanges']> {
  const heads = [...html.matchAll(/<h3[^>]*>\s*Released in Flutter (\d+\.\d+)\s*<\/h3>/g)];
  if (heads.length < 3) throw new Error(`Flutter breaking changes: only ${heads.length} releases listed (the page changed?)`);
  return heads.flatMap((m, i) => {
    if (!minors.includes(m[1])) return [];
    const list = html.slice(m.index! + m[0].length, heads[i + 1]?.index ?? html.length).match(/<ul[^>]*>([\s\S]*?)<\/ul>/)?.[1] ?? '';
    const changes = [...list.matchAll(/<li[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
      .map(([, href, title]) => ({ title: cleanText(title), url: new URL(href, FLUTTER_BREAKING_URL).href }))
      .filter(c => c.title);
    return changes.length ? [{ minor: m[1], changes }] : [];
  });
}

/** Partial results are fine; fails only when both frameworks failed */
export async function fetchFrameworks(): Promise<Frameworks> {
  const { values } = await settleSources('frameworks', [
    ['reactNative', async () => parseReactNativeReleases(await json<GithubRelease[]>(RN_RELEASES, githubHeaders()))],
    ['flutter', async () => {
      const flutter = parseFlutterReleases(await flutterIndex());
      // The breaking changes are extra: without them the releases still stand
      const breaking = await fetchText(FLUTTER_BREAKING_URL, {}, NETWORK_TIMEOUT_MS)
        .then(html => parseFlutterBreaking(html, flutter.recentMinors.map(r => minorOf(r.version))))
        .catch(err => { console.warn(`[frameworks] Flutter breaking changes failed (${(err as Error)?.message ?? err})`); return []; });
      return breaking.length ? { ...flutter, breakingChanges: breaking } : flutter;
    }],
  ] as const, () => true);
  return Object.fromEntries(values) as Frameworks;
}
