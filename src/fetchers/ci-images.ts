import { cleanText, fetchHtml } from './html-table.js';
import { compareVersions } from './ios-toolchain.js';

const TIMEOUT_MS = 15_000;
const RAW_BASE = 'https://raw.githubusercontent.com/actions/runner-images/main';
export const RUNNER_IMAGES_README_URL = `${RAW_BASE}/README.md`;
export const RUNNER_IMAGES_REPO_URL = 'https://github.com/actions/runner-images';
export const XCODE_CLOUD_NOTES_URL = 'https://developer.apple.com/xcode-cloud/release-notes/';

export interface InstalledXcode {
  version: string;
  build?: string;
  isDefault: boolean;
  isBeta: boolean;
}

export interface GithubMacosRunner {
  /** Primary label to use in `runs-on`, e.g. "macos-15" */
  label: string;
  /** Every label accepted for this image, e.g. ["macos-latest", "macos-26", "macos-26-xlarge"] */
  labels: string[];
  /** Row title in the runner-images README, e.g. "macOS 15 Arm64" or "Xcode 27" */
  name: string;
  arch: 'arm64' | 'x64';
  status: 'ga' | 'deprecated' | 'preview';
  /** e.g. "macOS 15.7.9 (24G830)" */
  os: string;
  defaultXcode?: string;
  /** Installed Xcode versions, newest first, e.g. ["26.3", "26.2", "16.4"] */
  xcodes: string[];
  xcodeDetails: InstalledXcode[];
  /** e.g. "20260907.0337.1" */
  imageVersion?: string;
  /** YYYY-MM-DD derived from imageVersion */
  imageDate?: string;
  /** Human-readable image readme on GitHub */
  url: string;
}

export interface XcodeCloudEvent {
  /** As written by Apple, e.g. "December 19, 2025" */
  date: string;
  /** Xcode / macOS versions announced as newly available, e.g. ["Xcode 26.2 (17C52)", "macOS Tahoe 26.2 (25C56)"] */
  added: string[];
  /** Xcode / macOS versions announced as no longer supported */
  removed: string[];
}

export interface XcodeCloudInfo {
  /**
   * Apple publishes no machine-readable list of the Xcode/macOS versions currently offered by Xcode Cloud
   * (the authoritative list lives in App Store Connect / the authenticated `ciXcodeVersions` API).
   * This is the public release-notes changelog, which can lag behind what is actually offered.
   */
  events: XcodeCloudEvent[];
  /** Most recent non-beta Xcode announced as available, e.g. "26.2" */
  latestAnnouncedXcode?: string;
  url: string;
}

export interface CiImages {
  githubActions: GithubMacosRunner[];
  /** undefined when Apple's release notes couldn't be fetched or parsed */
  xcodeCloud?: XcodeCloudInfo;
}

export interface RunnerImageRef {
  name: string;
  arch: 'arm64' | 'x64';
  status: 'ga' | 'deprecated' | 'preview';
  labels: string[];
  /** File name under images/macos, e.g. "macos-15-arm64-Readme.md" */
  readmeFile: string;
}

/** Reads the "Available Images" table of the runner-images README and returns the macOS / Xcode rows */
export function parseRunnerImagesReadme(markdown: string): RunnerImageRef[] {
  // Reference-style links at the bottom: [macOS-15-arm64]: https://github.com/.../images/macos/macos-15-arm64-Readme.md
  const refs = new Map<string, string>();
  for (const m of markdown.matchAll(/^\[([^\]]+)\]:\s*(\S+)/gm)) refs.set(m[1].toLowerCase(), m[2]);

  const images: RunnerImageRef[] = [];
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 4) continue;
    const [nameCell, archCell, labelCell, linkCell] = cells;
    const ref = linkCell.match(/\[([^\]]+)\]/)?.[1];
    const href = (ref && refs.get(ref.toLowerCase())) ?? linkCell.match(/\((https?:[^)]+)\)/)?.[1];
    const file = href?.match(/images\/macos\/([^/]+-Readme\.md)$/i)?.[1];
    if (!file) continue;

    const name = nameCell.split('<br>')[0].replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim();
    const status = /deprecated/i.test(nameCell) ? 'deprecated' : /preview|beta/i.test(nameCell) ? 'preview' : 'ga';
    images.push({
      name,
      arch: /arm64/i.test(archCell) ? 'arm64' : 'x64',
      status,
      labels: [...labelCell.matchAll(/`([^`]+)`/g)].map(m => m[1]),
      readmeFile: file,
    });
  }
  return images;
}

/** Parses one macOS image readme (images/macos/<file>-Readme.md) */
export function parseMacosImageReadme(markdown: string): Pick<GithubMacosRunner, 'os' | 'defaultXcode' | 'xcodes' | 'xcodeDetails' | 'imageVersion' | 'imageDate'> {
  const os = markdown.match(/^-\s*OS Version:\s*(.+)$/m)?.[1].trim() ?? '';
  const imageVersion = markdown.match(/^-\s*Image Version:\s*(\S+)/m)?.[1];
  const d = imageVersion?.match(/^(\d{4})(\d{2})(\d{2})\./);

  // The "### Xcode" section starts with a | Version | Build | Path | Symlinks | table
  const section = markdown.split(/^### Xcode\s*$/m)[1]?.split(/^#{2,4} /m)[0] ?? '';
  const xcodeDetails: InstalledXcode[] = [];
  for (const line of section.split('\n')) {
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    const version = cells[0]?.match(/^(\d+(?:\.\d+)*)/)?.[1];
    if (!version) continue;
    xcodeDetails.push({
      version,
      build: cells[1] || undefined,
      isDefault: /\(default\)/i.test(cells[0]),
      isBeta: /\b(beta|rc|release candidate)\b/i.test(cells[0]),
    });
  }
  xcodeDetails.sort((a, b) => compareVersions(b.version, a.version));

  return {
    os,
    defaultXcode: xcodeDetails.find(x => x.isDefault)?.version,
    xcodes: xcodeDetails.map(x => x.version),
    xcodeDetails,
    imageVersion,
    imageDate: d ? `${d[1]}-${d[2]}-${d[3]}` : undefined,
  };
}

const VERSION_ITEM = /\b(Xcode|macOS(?:\s+[A-Z][a-z]+)?)\s+(\d+(?:\.\d+)*(?:\s+(?:beta|Beta|RC)(?:\s*\d+)?)?(?:\s+\([a-z]\))?)\s*\(([0-9A-Za-z]+)\)/g;

function versionItems(text: string): string[] {
  return [...text.matchAll(VERSION_ITEM)].map(m => `${m[1]} ${m[2]} (${m[3]})`);
}

/** Parses Apple's Xcode Cloud release notes into dated "available" / "no longer supported" events, newest first */
export function parseXcodeCloudReleaseNotes(html: string): XcodeCloudEvent[] {
  const events: XcodeCloudEvent[] = [];
  const dateRe = /<h5[^>]*>\s*((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})\s*<\/h5>/g;
  const marks = [...html.matchAll(dateRe)];
  marks.forEach((m, i) => {
    const block = html.slice(m.index! + m[0].length, marks[i + 1]?.index ?? html.length);
    const text = cleanText(block);
    const added: string[] = [];
    const removed: string[] = [];
    if (/no longer supported/i.test(text)) {
      removed.push(...versionItems(text));
    } else {
      // Only sentences announcing availability; ignores e.g. "may fail with Xcode 26.2" in known issues
      for (const li of block.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
        const sentence = cleanText(li[1]);
        if (/(?:is|are) now available on Xcode Cloud/i.test(sentence)) added.push(...versionItems(sentence));
      }
    }
    if (added.length || removed.length) events.push({ date: m[1], added, removed });
  });
  return events;
}

export function latestXcodeFromEvents(events: XcodeCloudEvent[]): string | undefined {
  const versions = events.flatMap(e => e.added)
    .map(s => s.match(/^Xcode (\d+(?:\.\d+)*) \(/)?.[1])
    .filter((v): v is string => !!v);
  return versions.sort((a, b) => compareVersions(b, a))[0];
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return res.text();
}

/** GitHub-hosted macOS runner images (incl. preview/deprecated ones) with their installed Xcodes */
export async function fetchGithubMacosRunners(): Promise<GithubMacosRunner[]> {
  const refs = parseRunnerImagesReadme(await fetchText(RUNNER_IMAGES_README_URL));
  if (!refs.length) throw new Error('No macOS images found in actions/runner-images README');

  const runners = await Promise.all(refs.map(async ref => {
    const parsed = parseMacosImageReadme(await fetchText(`${RAW_BASE}/images/macos/${ref.readmeFile}`));
    // Prefer the plain version label ("macos-15") over "-latest"/"-xlarge"/"-large" aliases
    const label = ref.labels.find(l => !/latest|large/.test(l)) ?? ref.labels[0] ?? ref.readmeFile.replace(/-Readme\.md$/i, '');
    return {
      label,
      labels: ref.labels,
      name: ref.name,
      arch: ref.arch,
      status: ref.status,
      ...parsed,
      url: `${RUNNER_IMAGES_REPO_URL}/blob/main/images/macos/${ref.readmeFile}`,
    };
  }));
  const usable = runners.filter(r => r.os && r.xcodes.length);
  if (!usable.length) throw new Error('Could not parse any macOS runner image readme');
  return usable;
}

export async function fetchXcodeCloudInfo(): Promise<XcodeCloudInfo> {
  const events = parseXcodeCloudReleaseNotes(await fetchHtml(XCODE_CLOUD_NOTES_URL));
  if (!events.length) throw new Error('No Xcode Cloud version announcements found');
  return { events, latestAnnouncedXcode: latestXcodeFromEvents(events), url: XCODE_CLOUD_NOTES_URL };
}

/** Throws if GitHub runner data can't be loaded; Xcode Cloud is best-effort (undefined on failure) */
export async function fetchCiImages(): Promise<CiImages> {
  const [githubActions, xcodeCloud] = await Promise.all([
    fetchGithubMacosRunners(),
    fetchXcodeCloudInfo().catch(err => {
      console.warn(`Xcode Cloud release notes unavailable: ${err instanceof Error ? err.message : err}`);
      return undefined;
    }),
  ]);
  return { githubActions, xcodeCloud };
}
