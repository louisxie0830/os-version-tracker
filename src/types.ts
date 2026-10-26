export interface OSVersionInfo {
  platform: 'iOS' | 'Android';
  version: string;
  build?: string;
  apiLevel?: string;
  codename?: string;
  releaseDate: string;
  supportedDevices?: string[];
  isBeta?: boolean;
}

export interface SDKRequirement {
  platform: string;
  sdk: string;
}

export interface SubmissionDeadline {
  source: 'apple' | 'google';
  deadline: string;
  announcedAt?: string;
  requirements: SDKRequirement[];
  extensionDate?: string;
  /** "month" when only a month was announced ("Starting April 2027"): `deadline` is then that month's first day */
  datePrecision?: 'month';
  /** The post that announced it (Apple Developer News) */
  url?: string;
  /** Google Play: earlier deadlines still on the page (a newer one posted while an older extension is open) */
  earlier?: SubmissionDeadline[];
}

export interface XcodeRelease {
  version: string;
  label: string;
  build: string;
  isBeta: boolean;
  releaseDate: string;
  requiresMacOS: string;
  iosSdk?: string;
  swift?: string;
  notesUrl?: string;
}

export interface iPhoneModel {
  name: string;
  releaseDate: string;
  shipsWithiOS: string;
}

export interface iOSToolchain {
  xcodeStable?: XcodeRelease;
  xcodeBeta?: XcodeRelease;
  releases: XcodeRelease[];
  newestiPhones: iPhoneModel[];
  /** Every iPhone model endoflife.date knows about, used to spot newly announced ones */
  knowniPhones: string[];
}

export interface ToolVersion {
  name: string;
  version: string;
  channel?: string;
  releaseDate?: string;
  url?: string;
}

export interface AndroidToolchain {
  studioStable?: ToolVersion;
  studioPreview?: ToolVersion;
  agpStable?: ToolVersion;
  agpPreview?: ToolVersion;
  gradle?: ToolVersion;
  kotlin?: ToolVersion;
  sdkPlatform?: ToolVersion;
  buildTools?: ToolVersion;
  composeBom?: ToolVersion;
}

export type ActionStatus = 'ok' | 'upcoming' | 'urgent' | 'info';

export interface ActionItem {
  status: ActionStatus;
  title: string;
  detail: string;
  url?: string;
  /** Derived from historical patterns rather than an official announcement */
  estimated?: boolean;
  /**
   * When a requirement still ahead takes effect or is due (YYYY-MM-DD; a month-only one: that month's first day,
   * a year-only one: that year's last), for lists ordered or cut off by date such as 待處理
   */
  dueDate?: string;
  /** Where the item comes from; defaults to official (or estimate when `estimated`) */
  basis?: ActionBasis;
}

/** official: vendor requirement or compatibility table · estimate: projected from past patterns ·
 *  community: unconfirmed reports · reference: third-party statistics */
export type ActionBasis = 'official' | 'estimate' | 'community' | 'reference';


export interface NewsItem {
  title: string;
  url: string;
  date: string;
  important: boolean;
}

export interface AdoptionShare {
  name: string;
  value: number;
}

export interface iOSAdoption {
  measuredAt?: string;
  recentDevices: AdoptionShare[];
  allDevices: AdoptionShare[];
}


export interface AndroidCompat {
  agpGradle: Array<{ agp: string; minGradle: string }>;
  studioAgp: Array<{ studio: string; agp: [string, string] }>;
  apiLevels: Array<{ api: string; minStudio: string; minAgp: string }>;
  kotlin: Array<{ kotlin: string; gradle: [string, string]; agp: [string, string] }>;
  current: { agp: string; maxApi?: string; minGradle?: string; minBuildTools?: string; jdk?: string };
}

export interface XcodeSupportRow {
  xcode: string;
  macOS: string;
  iosSdk?: string;
  deploymentiOS?: string;
  deviceiOS?: string;
  simulatoriOS?: string;
  swift?: string;
}

export interface Deadline {
  platform: 'iOS' | 'Android';
  date: string; // YYYY-MM-DD
  title: string;
  detail: string;
  source: string;
  url: string;
  extensionDate?: string;
  /** Set on the published timeline when only a month or a year was announced (`date` is then its first day) */
  datePrecision?: 'month' | 'year';
}

export interface AnnouncedDevice {
  name: string;
  title: string;
  url: string;
  date: string;
}

/** Marks where a block's data came from, so readers can verify it */
export interface SourceInfo {
  label: string;
  url: string;
  fetchedAt: string;
  ok: boolean;
  /**
   * This refresh failed and the data shown is the source's last good result, fetched at this time
   * (last-good.ts). Internal: the API keeps the original { label, url, fetchedAt, ok } shape (api.ts).
   */
  staleFrom?: string;
}
