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
