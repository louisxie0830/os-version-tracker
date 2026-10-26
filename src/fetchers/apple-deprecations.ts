import { fetchJson, NETWORK_TIMEOUT_MS } from '../net.js';

/**
 * Apple server APIs that apps' backends still commonly use and Apple has marked deprecated in its documentation
 * (the DocC data behind developer.apple.com/documentation: `platforms[].deprecatedAt`). No shutdown date is
 * published; when one is, it belongs on the timeline. Each entry says what replaces it.
 */
export interface AppleDeprecation {
  name: string;
  /** Deprecated as of this version of the service, as Apple's documentation states it */
  deprecatedAt: string;
  replacement: string;
  url: string;
}

const DOCS = 'https://developer.apple.com/documentation';
const DATA = 'https://developer.apple.com/tutorials/data/documentation';

export const WATCHED: Array<{ path: string; name: string; replacement: string }> = [
  { path: 'appstorereceipts', name: 'App Store 收據驗證（App Store Receipts / verifyReceipt）', replacement: '伺服器端改用 App Store Server API，App 端改用 StoreKit 2 的 AppTransaction 與 Transaction' },
  { path: 'appstoreservernotifications/app-store-server-notifications-v1', name: 'App Store Server Notifications V1', replacement: '改用 App Store Server Notifications V2（在 App Store Connect 切換通知版本）' },
];

interface DocData {
  metadata?: { title?: string; platforms?: Array<{ name?: string; deprecatedAt?: string }> };
}

/** The watched page's deprecation, if its documentation marks one */
export function parseDeprecation(data: DocData, watched: (typeof WATCHED)[number]): AppleDeprecation | null {
  if (!data.metadata) throw new Error(`${watched.path}: no metadata (the documentation format changed?)`);
  const deprecatedAt = data.metadata.platforms?.find(p => p.deprecatedAt)?.deprecatedAt;
  return deprecatedAt ? { name: watched.name, deprecatedAt, replacement: watched.replacement, url: `${DOCS}/${watched.path}` } : null;
}

export async function fetchAppleDeprecations(): Promise<AppleDeprecation[]> {
  const found = await Promise.all(WATCHED.map(async w =>
    parseDeprecation(await fetchJson<DocData>(`${DATA}/${w.path}.json`, {}, NETWORK_TIMEOUT_MS, status => `${w.path} HTTP ${status}`), w)));
  return found.filter((d): d is AppleDeprecation => d !== null);
}
