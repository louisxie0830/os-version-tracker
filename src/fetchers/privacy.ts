import { cleanText, fetchHtml } from './html-table.js';
import { SLOW_NETWORK_TIMEOUT_MS as TIMEOUT_MS } from '../net.js';

const APPLE_DOCS_JSON = 'https://developer.apple.com/tutorials/data/documentation';
export const REQUIRED_REASON_TYPES_JSON_URL = `${APPLE_DOCS_JSON}/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype.json`;
export const REQUIRED_REASON_DOC_URL = 'https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api';
export const REQUIRED_REASON_TYPES_DOC_URL = 'https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype';
export const THIRD_PARTY_SDK_URL = 'https://developer.apple.com/support/third-party-SDK-requirements/';

export interface RequiredReasonApiCategory {
  /** Human label, e.g. "File timestamp" */
  category: string;
  /** Value for NSPrivacyAccessedAPIType, e.g. "NSPrivacyAccessedAPICategoryFileTimestamp" */
  key: string;
  /** APIs covered by the category, e.g. ["creationDate", "modificationDate", "stat(_:_:)", ...] */
  apis: string[];
  /** Approved reason codes for NSPrivacyAccessedAPITypeReasons, with the first sentence of Apple's description */
  reasons: Array<{ code: string; description: string }>;
  url: string;
}

export interface PrivacyLink {
  title: string;
  url: string;
  note: string;
  platform: 'ios' | 'android';
}

export interface PrivacyCompliance {
  appleRequiredReasonApis: RequiredReasonApiCategory[];
  appleSdksRequiringManifest: string[];
  /** Source of appleSdksRequiringManifest */
  appleSdksUrl: string;
  links: PrivacyLink[];
}

/**
 * Google Play has no public machine-readable list of outdated / non-compliant SDK versions:
 * the SDK Index (play.google.com/sdks) is a client-rendered app with no data in its HTML,
 * and per-app SDK warnings only appear inside Play Console. So for Android we return official links.
 */
export const PRIVACY_LINKS: PrivacyLink[] = [
  {
    platform: 'ios',
    title: 'Privacy manifest files',
    url: 'https://developer.apple.com/documentation/bundleresources/privacy-manifest-files',
    note: 'PrivacyInfo.xcprivacy 的格式：追蹤網域、蒐集的資料類型，以及 App 與 SDK 使用 Required Reason API 的原因。',
  },
  {
    platform: 'ios',
    title: 'Describing use of required reason API',
    url: REQUIRED_REASON_DOC_URL,
    note: '自 2024 年 5 月 1 日起，使用這些 API 但未宣告核准原因的 App 會被 App Store Connect 拒絕上傳。',
  },
  {
    platform: 'ios',
    title: 'Third-party SDK requirements',
    url: THIRD_PARTY_SDK_URL,
    note: '名單上的 SDK 須內含隱私清單；以二進位方式引入時還須有簽章。',
  },
  {
    platform: 'android',
    title: 'Google Play SDK Index',
    url: 'https://play.google.com/sdks',
    note: '搜尋 SDK，查看供應商標示為過時或違反 Play 政策的版本（只能在網頁上查詢，沒有公開資料）。',
  },
  {
    platform: 'android',
    title: 'Using SDKs safely and securely',
    url: 'https://support.google.com/googleplay/android-developer/answer/13326895?hl=en',
    note: 'Play Console 在 App bundle explorer 與發布前報告中顯示的 SDK 警告，以及處理方式。',
  },
  {
    platform: 'android',
    title: "Google Play's Data safety section",
    url: 'https://support.google.com/googleplay/android-developer/answer/10787469?hl=en',
    note: '須申報 App 蒐集或分享的資料，包含內含的第三方 SDK 所蒐集的資料。',
  },
  {
    platform: 'android',
    title: 'About user safety and SDKs',
    url: 'https://developer.android.com/guide/practices/sdk-best-practices?hl=en',
    note: 'Android 官方對評估第三方 SDK、保持 SDK 更新的建議。',
  },
  {
    platform: 'android',
    title: 'Policy deadlines',
    url: 'https://support.google.com/googleplay/android-developer/answer/12253906?hl=en',
    note: 'Google Play 即將執行的政策期限，包含 SDK 與資料相關政策。',
  },
];

// Minimal shape of Apple's DocC render JSON that we rely on
interface DocNode {
  type?: string;
  text?: string;
  code?: string;
  identifier?: string;
  inlineContent?: DocNode[];
  content?: DocNode[];
  items?: Array<{ content?: DocNode[]; term?: DocNode; definition?: DocNode }>;
}
interface DocJson {
  primaryContentSections?: Array<{ kind: string; values?: Array<{ name: string; content: DocNode[] }> }>;
  references?: Record<string, { title?: string }>;
}

function inlineText(nodes: DocNode[] | undefined, refs: DocJson['references']): string {
  return (nodes ?? []).map(n =>
    n.type === 'text' ? n.text ?? ''
      : n.type === 'codeVoice' ? n.code ?? ''
        : n.type === 'reference' ? refs?.[n.identifier ?? '']?.title ?? n.identifier?.split('/').pop() ?? ''
          : inlineText(n.inlineContent, refs),
  ).join('').replace(/\s+/g, ' ').trim();
}

/** "NSPrivacyAccessedAPICategoryFileTimestamp" → "File timestamp" */
function categoryLabel(key: string): string {
  const words = key.replace(/^NSPrivacyAccessedAPICategory/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Parses Apple's NSPrivacyAccessedAPIType docs JSON (its "Possible values" section lists every category) */
export function parseRequiredReasonApis(json: DocJson): RequiredReasonApiCategory[] {
  const values = json.primaryContentSections?.find(s => s.kind === 'possibleValues')?.values ?? [];
  return values
    .filter(v => /^NSPrivacyAccessedAPICategory/.test(v.name))
    .map(v => {
      const apis = v.content
        .filter(n => n.type === 'unorderedList')
        .flatMap(n => n.items ?? [])
        .map(i => inlineText(i.content?.[0]?.inlineContent, json.references))
        .filter(Boolean);
      const reasons = v.content
        .filter(n => n.type === 'termList')
        .flatMap(n => n.items ?? [])
        .map(i => ({
          code: inlineText(i.term?.inlineContent, json.references),
          description: inlineText(i.definition?.content?.[0]?.inlineContent, json.references),
        }))
        .filter(r => /^[0-9A-F]{4}\.\d+$/.test(r.code));
      return {
        category: categoryLabel(v.name),
        key: v.name,
        apis,
        reasons,
        url: `${REQUIRED_REASON_TYPES_DOC_URL}#${v.name}`,
      };
    });
}

/** Parses the "SDKs that require a privacy manifest and signature" list on Apple's third-party SDK page */
export function parseSdksRequiringManifest(html: string): string[] {
  const start = html.search(/SDKs that require a privacy manifest/i);
  if (start < 0) return [];
  const list = html.slice(start).match(/<ul[^>]*>([\s\S]*?)<\/ul>/)?.[1] ?? '';
  return [...list.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(m => cleanText(m[1])).filter(Boolean);
}

export async function fetchRequiredReasonApis(): Promise<RequiredReasonApiCategory[]> {
  const res = await fetch(REQUIRED_REASON_TYPES_JSON_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${REQUIRED_REASON_TYPES_JSON_URL} failed: ${res.status}`);
  const categories = parseRequiredReasonApis(await res.json() as DocJson);
  if (!categories.length) throw new Error('No required reason API categories found');
  return categories;
}

export async function fetchSdksRequiringManifest(): Promise<string[]> {
  const sdks = parseSdksRequiringManifest(await fetchHtml(THIRD_PARTY_SDK_URL));
  if (!sdks.length) throw new Error('No SDKs found on Apple third-party SDK requirements page');
  return sdks;
}

export async function fetchPrivacyCompliance(): Promise<PrivacyCompliance> {
  const [appleRequiredReasonApis, appleSdksRequiringManifest] = await Promise.all([
    fetchRequiredReasonApis(),
    fetchSdksRequiringManifest(),
  ]);
  return { appleRequiredReasonApis, appleSdksRequiringManifest, appleSdksUrl: THIRD_PARTY_SDK_URL, links: PRIVACY_LINKS };
}
