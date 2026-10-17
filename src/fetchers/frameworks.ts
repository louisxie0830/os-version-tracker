import { fetchJson, NETWORK_TIMEOUT_MS, USER_AGENT } from '../net.js';
import { settleSources } from './settle.js';

/**
 * React Native and Flutter releases, the cross-platform counterparts of the Cordova section:
 * - React Native: GitHub releases of facebook/react-native. For each minor's first stable release the
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
}

export interface Frameworks {
  reactNative?: FrameworkInfo;
  flutter?: FrameworkInfo;
}

const MINORS = 4;
const RN_RELEASES = 'https://api.github.com/repos/facebook/react-native/releases?per_page=60';
const FLUTTER_RELEASES = 'https://storage.googleapis.com/flutter_infra_release/releases/releases_macos.json';

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
  const toRelease = (r: (typeof stable)[number]): FrameworkRelease => ({ version: r.version, date: r.published_at.slice(0, 10), url: r.html_url });
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
    releaseNotesUrl: 'https://github.com/facebook/react-native/releases',
    breakingChangesUrl: 'https://reactnative.dev/blog',
  };
}

interface FlutterIndex {
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
    date: r.release_date.slice(0, 10),
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

/** Partial results are fine; fails only when both frameworks failed */
export async function fetchFrameworks(): Promise<Frameworks> {
  const githubHeaders: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT };
  if (process.env.GITHUB_TOKEN) githubHeaders.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const { values } = await settleSources('frameworks', [
    ['reactNative', async () => parseReactNativeReleases(await json<GithubRelease[]>(RN_RELEASES, githubHeaders))],
    ['flutter', async () => parseFlutterReleases(await json<FlutterIndex>(FLUTTER_RELEASES))],
  ] as const, () => true);
  return Object.fromEntries(values) as Frameworks;
}
