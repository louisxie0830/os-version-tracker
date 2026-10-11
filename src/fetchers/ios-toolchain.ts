import type { iOSToolchain, iPhoneModel, XcodeRelease } from '../types.js';

const TIMEOUT_MS = 15_000;

interface XcodeReleasesEntry {
  name: string;
  version: {
    number: string;
    build: string;
    release: Record<string, boolean | number>;
  };
  date: { year: number; month: number; day: number };
  requires: string;
  sdks?: { iOS?: Array<{ number: string }> };
  compilers?: { swift?: Array<{ number: string }> };
  links?: { notes?: { url: string } };
}

interface EndOfLifeiPhone {
  releaseLabel: string;
  releaseDate: string;
  supportedIosVersions?: string;
}

function stageLabel(release: Record<string, boolean | number>): { label: string; isBeta: boolean } {
  if (release.release) return { label: '', isBeta: false };
  if (release.rc !== undefined) return { label: `RC ${release.rc}`, isBeta: true };
  if (release.beta !== undefined) return { label: `beta ${release.beta}`, isBeta: true };
  if (release.gm !== undefined) return { label: 'GM', isBeta: true };
  if (release.dp !== undefined) return { label: `DP ${release.dp}`, isBeta: true };
  return { label: 'pre-release', isBeta: true };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function compareVersions(a: string, b: string): number {
  const va = a.split('.').map(Number);
  const vb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const diff = (va[i] ?? 0) - (vb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function fetchXcodeReleases(): Promise<XcodeRelease[]> {
  const res = await fetch('https://xcodereleases.com/data.json', { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`xcodereleases.com request failed: ${res.status}`);
  }
  const data = await res.json() as XcodeReleasesEntry[];

  return data
    .filter(x => x.name === 'Xcode')
    .map(x => {
      const { label, isBeta } = stageLabel(x.version.release);
      return {
        version: x.version.number,
        label: label ? `${x.version.number} ${label}` : x.version.number,
        build: x.version.build,
        isBeta,
        releaseDate: `${x.date.year}-${pad(x.date.month)}-${pad(x.date.day)}`,
        requiresMacOS: x.requires,
        iosSdk: x.sdks?.iOS?.[0]?.number,
        swift: x.compilers?.swift?.[0]?.number,
        notesUrl: x.links?.notes?.url,
      };
    });
}

async function fetchiPhones(): Promise<{ newest: iPhoneModel[]; known: string[] }> {
  const res = await fetch('https://endoflife.date/api/iphone.json', { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`endoflife.date iPhone request failed: ${res.status}`);
  }
  const data = await res.json() as EndOfLifeiPhone[];
  if (!data.length) return { newest: [], known: [] };

  // The most recent launch may include several models (e.g. Pro and Pro Max)
  const newestDate = data.map(d => d.releaseDate).sort().at(-1)!;
  const newest = data
    .filter(d => d.releaseDate === newestDate)
    .map(d => ({
      name: `iPhone ${d.releaseLabel}`,
      releaseDate: d.releaseDate,
      // "26 - 27" → the device ships with the lowest supported version
      shipsWithiOS: d.supportedIosVersions?.match(/\d+(?:\.\d+)?/)?.[0] ?? 'unknown',
    }));
  return { newest, known: data.map(d => `iPhone ${d.releaseLabel}`) };
}

/**
 * Earliest stable Xcode whose bundled iOS SDK is at least `minSdk`.
 * When only pre-releases qualify (e.g. for an iOS beta), returns the newest pre-release instead.
 */
export function minXcodeForiOSSdk(releases: XcodeRelease[], minSdk: string): XcodeRelease | undefined {
  const qualifying = releases
    .filter(r => r.iosSdk && compareVersions(r.iosSdk, minSdk) >= 0)
    .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
  return qualifying.find(r => !r.isBeta) ?? qualifying.at(-1);
}

export async function fetchiOSToolchain(): Promise<iOSToolchain> {
  const [xcodeResult, iphoneResult] = await Promise.allSettled([
    fetchXcodeReleases(),
    fetchiPhones(),
  ]);

  if (xcodeResult.status === 'rejected') {
    console.warn(`[iOS toolchain] Xcode releases failed (${(xcodeResult.reason as Error).message})`);
  }
  if (iphoneResult.status === 'rejected') {
    console.warn(`[iOS toolchain] iPhone models failed (${(iphoneResult.reason as Error).message})`);
  }

  const releases = xcodeResult.status === 'fulfilled' ? xcodeResult.value : [];
  const iphones = iphoneResult.status === 'fulfilled' ? iphoneResult.value : { newest: [], known: [] };

  // data.json is ordered newest first
  const xcodeStable = releases.find(r => !r.isBeta);
  const xcodeBeta = releases.find(r => r.isBeta && (!xcodeStable || compareVersions(r.version, xcodeStable.version) > 0));

  return { xcodeStable, xcodeBeta, releases, newestiPhones: iphones.newest, knowniPhones: iphones.known };
}
