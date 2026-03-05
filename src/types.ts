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
}
