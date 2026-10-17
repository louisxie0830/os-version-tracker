import { fetchJson, fetchText, NETWORK_TIMEOUT_MS } from '../net.js';
import { settleSources } from './settle.js';
import { compareVersions } from './ios-toolchain.js';

/**
 * Apache Cordova platform releases and what to watch for when upgrading: the latest version (npm),
 * its Node requirement, the breaking changes of the current major and the fixes in the latest
 * release (the repo's RELEASENOTES.md, Apache License 2.0).
 */

export interface CordovaPlatform {
  name: 'cordova-ios' | 'cordova-android';
  platform: 'iOS' | 'Android';
  latest: string;
  /** engines.node of the latest version */
  node?: string;
  /** GitHub release date (YYYY-MM-DD), when known */
  releasedAt?: string;
  /** First release of the current major, e.g. "8.0.0" */
  majorRelease: string;
  /** Breaking changes listed for the current major's x.0.0 release */
  breaking: string[];
  /** Fixes listed for the latest release */
  fixes: string[];
  notesUrl: string;
  issuesUrl: string;
}

export interface CordovaPlugin {
  name: string;
  latest: string;
  /** Platform / CLI versions the latest release needs, from engines.cordovaDependencies */
  requires: Record<string, string>;
  repoUrl: string;
}

export interface CordovaReleases {
  platforms: CordovaPlatform[];
  plugins: CordovaPlugin[];
}

export const CORDOVA_PLUGINS = ['camera', 'inappbrowser', 'file', 'file-transfer', 'geolocation', 'media', 'network-information']
  .map(name => `cordova-plugin-${name}`);

/**
 * Requirements for `version` from a plugin's engines.cordovaDependencies: the entry with the highest key
 * not above it. Keys like "9.0.0": { "cordova": ">100" } mark unreleased majors and "-dev" keys are
 * development builds; both are skipped.
 */
export function pluginRequirements(deps: Record<string, Record<string, string>> | undefined, version: string): Record<string, string> {
  const key = Object.keys(deps ?? {})
    .filter(k => /^\d+(\.\d+)*$/.test(k) && compareVersions(k, version) <= 0 && deps![k].cordova !== '>100')
    .sort(compareVersions)
    .at(-1);
  return key ? { ...deps![key] } : {};
}

export const CORDOVA_PLATFORMS = [
  { name: 'cordova-ios', platform: 'iOS' },
  { name: 'cordova-android', platform: 'Android' },
] as const;

interface NotesSection {
  version: string;
  /** Bullet lists keyed by their bold heading ("Breaking Changes", "Fixes", …) */
  lists: Map<string, string[]>;
}

/** Strips PR / commit links and markdown emphasis from a release-notes bullet */
export function cleanNoteLine(line: string): string {
  return line
    .replace(/^\s*[*-]\s+/, '')
    .replace(/^\[GH-\d+\]\([^)]*\)\s*/, '')
    .replace(/\s*\(\[#\d+\]\([^)]*\)\)/g, '')
    .replace(/\s*\[\[[0-9a-f]+\]\([^)]*\)\]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits RELEASENOTES.md into "### <version>" sections with their bold-headed bullet lists */
export function parseReleaseNotes(markdown: string): NotesSection[] {
  return markdown.split(/^###\s+/m).slice(1).flatMap(part => {
    const [headingLine, ...lines] = part.split('\n');
    const version = headingLine.match(/^(\d+\.\d+\.\d+(?:-[\w.]+)?)/)?.[1];
    if (!version) return [];
    const lists = new Map<string, string[]>();
    let current: string[] | null = null;
    for (const line of lines) {
      const heading = line.match(/^\*\*([^*]+?):?\*\*:?\s*$/)?.[1];
      if (heading) {
        current = [];
        lists.set(heading.replace(/:$/, '').trim(), current);
      } else if (current && /^\s*[*-]\s+/.test(line)) {
        const text = cleanNoteLine(line);
        if (text) current.push(text);
      }
    }
    return [{ version, lists }];
  });
}

const listOf = (section: NotesSection | undefined, heading: RegExp) =>
  [...(section?.lists ?? new Map<string, string[]>()).entries()].filter(([h]) => heading.test(h)).flatMap(([, items]) => items);

export function summarizeReleaseNotes(markdown: string, latest: string): Pick<CordovaPlatform, 'majorRelease' | 'breaking' | 'fixes'> {
  const sections = parseReleaseNotes(markdown);
  const majorRelease = `${latest.split('.')[0]}.0.0`;
  return {
    majorRelease,
    breaking: listOf(sections.find(s => s.version === majorRelease), /^breaking/i),
    fixes: listOf(sections.find(s => s.version === latest), /^(?:bug )?fix/i),
  };
}

const json = <T>(url: string, headers: Record<string, string> = {}) => fetchJson<T>(url, { headers: { Accept: 'application/json', ...headers } }, NETWORK_TIMEOUT_MS, status => `HTTP ${status}`);

async function fetchPlatform({ name, platform }: typeof CORDOVA_PLATFORMS[number]): Promise<CordovaPlatform> {
  const repo = `https://github.com/apache/${name}`;
  // /latest is a few KB; the full package document is several MB
  const manifest = await json<{ version: string; engines?: { node?: string } }>(`https://registry.npmjs.org/${name}/latest`);

  const notesText = await fetchText(`https://raw.githubusercontent.com/apache/${name}/master/RELEASENOTES.md`, {}, NETWORK_TIMEOUT_MS, status => `RELEASENOTES.md HTTP ${status}`);
  const notes = summarizeReleaseNotes(notesText, manifest.version);

  // Release date is a nice-to-have; GitHub's unauthenticated API allows 60 requests an hour
  const githubHeaders: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) githubHeaders.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const release = await json<{ published_at?: string }>(`https://api.github.com/repos/apache/${name}/releases/tags/rel/${manifest.version}`, githubHeaders)
    .catch(() => null);

  return {
    name,
    platform,
    latest: manifest.version,
    node: manifest.engines?.node,
    releasedAt: release?.published_at?.slice(0, 10),
    ...notes,
    notesUrl: `${repo}/blob/master/RELEASENOTES.md`,
    issuesUrl: `${repo}/issues`,
  };
}

async function fetchPlugin(name: string): Promise<CordovaPlugin> {
  const manifest = await json<{ version: string; engines?: { cordovaDependencies?: Record<string, Record<string, string>> } }>(`https://registry.npmjs.org/${name}/latest`);
  return {
    name,
    latest: manifest.version,
    requires: pluginRequirements(manifest.engines?.cordovaDependencies, manifest.version),
    repoUrl: `https://github.com/apache/${name}`,
  };
}

/** Partial results are fine; fails only when both platforms failed (plugins are extra) */
export async function fetchCordovaReleases(): Promise<CordovaReleases> {
  const [platforms, plugins] = await Promise.all([
    settleSources('cordova', CORDOVA_PLATFORMS.map(p => [p.name, () => fetchPlatform(p)] as const)),
    Promise.allSettled(CORDOVA_PLUGINS.map(fetchPlugin)),
  ]);
  for (const [i, r] of plugins.entries()) {
    if (r.status === 'rejected') console.warn(`[cordova] ${CORDOVA_PLUGINS[i]} failed (${(r.reason as Error)?.message ?? r.reason})`);
  }
  return {
    platforms: CORDOVA_PLATFORMS.flatMap(p => platforms.values.get(p.name) ?? []),
    plugins: plugins.flatMap(r => r.status === 'fulfilled' ? [r.value] : []),
  };
}
