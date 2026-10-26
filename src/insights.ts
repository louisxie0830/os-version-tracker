import { minXcodeForiOSSdk } from './fetchers/ios-toolchain.js';
import { calendarDate, daysUntil, taipeiToday } from './taipei-date.js';
import { compareVersions } from './versions.js';
import { PLAY_POLICY_URL, type PlayBillingInfo } from './fetchers/requirements.js';
import type { GithubMacosRunner } from './fetchers/ci-images.js';
import type { OsShare } from './fetchers/os-share.js';
import type { BehaviorChanges } from './fetchers/behavior-changes.js';
import type { AppleDeprecation } from './fetchers/apple-deprecations.js';
import { datePrecision, lastPossibleDay, periodLabel, submissionDay, urgencyDay } from './deadline-dates.js';
import type {
  ActionItem,
  ActionStatus,
  AndroidCompat,
  AndroidToolchain,
  AnnouncedDevice,
  Deadline,
  iOSAdoption,
  XcodeSupportRow,
  iOSToolchain,
  OSVersionInfo,
  SubmissionDeadline,
  XcodeRelease,
} from './types.js';

const MONTH_PATTERN = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
const DAY_MS = 24 * 60 * 60 * 1000;
const URGENT_DAYS = 60;

function countdown(days: number): string {
  if (days === 0) return '就是今天';
  if (days === 1) return '明天';
  return `剩 ${days} 天`;
}

/** "April 28, 2026" → "2026 年 4 月 28 日"; unparseable input is returned as-is */
export function zhDate(date: string): string {
  const day = calendarDate(date);
  if (!day) return date;
  const [y, m, d] = day.split('-').map(Number);
  return `${y} 年 ${m} 月 ${d} 日`;
}

function deadlineStatus(days: number): ActionStatus {
  return days <= URGENT_DAYS ? 'urgent' : 'upcoming';
}

function xcodeRequirement(x: XcodeRelease): string {
  return `Xcode ${x.label} 以上（需 macOS ${x.requiresMacOS} 以上）`;
}

function majorOf(version: string): string | undefined {
  return version.match(/\d+/)?.[0];
}

export function buildiOSActions(
  ios: OSVersionInfo[],
  toolchain: iOSToolchain | null,
  deadline: SubmissionDeadline | null,
  extra: {
    adoption?: iOSAdoption | null;
    xcodeSupport?: XcodeSupportRow[];
    requirements?: Deadline[];
    announcedDevices?: AnnouncedDevice[];
    ciRunners?: GithubMacosRunner[];
    osShare?: OsShare | null;
    deprecations?: AppleDeprecation[];
  } = {},
  now = new Date(),
): ActionItem[] {
  const actions: ActionItem[] = [];
  const releases = toolchain?.releases ?? [];
  const { adoption = null, xcodeSupport = [], requirements = [], announcedDevices = [], ciRunners = [], osShare = null, deprecations = [] } = extra;

  // 1. App Store SDK requirement → which Xcode / macOS you need
  const iosReq = deadline?.requirements.find(r => /\biOS\b/.test(r.platform) || /\biOS\b/.test(r.sdk));
  const requiredSdk = iosReq?.sdk.match(/iOS\s+(\d+(?:\.\d+)?)/)?.[1];
  if (deadline && requiredSdk) {
    const xcode = minXcodeForiOSSdk(releases, requiredSdk);
    const days = daysUntil(deadline.deadline, now);
    const need = xcode ? xcodeRequirement(xcode) : `iOS ${requiredSdk} SDK`;
    // Announced by month only ("Starting April 2027"): no day to count to, and pending until the month is over
    const day = submissionDay(deadline);
    const period = day && periodLabel(day);
    const pendingIn = day && period ? daysUntil(lastPossibleDay(day), now) : days;
    const inEffect = days !== null && days < 0 && !(pendingIn !== null && pendingIn >= 0);
    const dueIn = days === null ? null : Math.max(0, days);
    const when = period ? `${period}起` : `${zhDate(deadline.deadline)} 起`;
    actions.push({
      status: inEffect ? 'ok' : deadlineStatus(dueIn ?? Infinity),
      ...(!inEffect && day ? { dueDate: day.date } : {}),
      title: `上架 App Store 必須使用 iOS ${requiredSdk} SDK 建置`,
      detail: inEffect
        ? `自 ${period ?? zhDate(deadline.deadline)} 起生效。最低需求：${need}。`
        : period
          ? `${when}生效（Apple 只公布月份，確切日期未定）。請升級至 ${need}。`
          : `${when}生效（${countdown(days!)}）。請升級至 ${need}。`,
      url: deadline.url ?? 'https://developer.apple.com/news/upcoming-requirements/',
    });

    // Apple has raised the minimum SDK every spring; flag the next one once a newer SDK ships
    const stableSdk = toolchain?.xcodeStable?.iosSdk;
    const nextMajor = stableSdk ? majorOf(stableSdk) : undefined;
    if (inEffect && nextMajor && Number(nextMajor) > Number(majorOf(requiredSdk))) {
      const nextXcode = minXcodeForiOSSdk(releases, nextMajor);
      actions.push({
        status: 'upcoming',
        title: `預計下一波：要求 iOS ${nextMajor} SDK`,
        detail: `Apple 通常每年 4 月左右開始強制使用最新 SDK，建議提早準備 ${nextXcode ? xcodeRequirement(nextXcode) : `Xcode ${nextMajor}`}。`,
        url: 'https://developer.apple.com/news/upcoming-requirements/',
        estimated: true,
      });
    }
  }

  // 1b. Minimum deployment target App Store Connect accepts, plus what current Xcode can still target
  const latestXcode = xcodeSupport.find(r => !/beta|RC/i.test(r.xcode));
  const minTarget = requirements.find(r => /must target iOS \d+/i.test(r.detail));
  if (minTarget) {
    const version = minTarget.detail.match(/must target iOS (\d+(?:\.\d+)?)/i)![1];
    const days = daysUntil(minTarget.date, now);
    const xcodeFloor = latestXcode?.deploymentiOS?.split('–')[0];
    actions.push({
      status: days !== null && days >= 0 ? deadlineStatus(days) : 'ok',
      ...(days !== null && days >= 0 ? { dueDate: minTarget.date } : {}),
      title: `上架 App 的最低部署版本須為 iOS ${version} 以上`,
      detail: `${days !== null && days >= 0 ? `${zhDate(minTarget.date)} 起生效（${countdown(days)}）` : `自 ${zhDate(minTarget.date)} 起生效`}。`
        + `Deployment Target 低於 iOS ${version} 的 App 無法上傳至 App Store Connect。`
        + (xcodeFloor && latestXcode ? `另外，Xcode ${latestXcode.xcode} 可設定的最低部署版本為 iOS ${xcodeFloor}。` : ''),
      url: minTarget.url,
    });
  }

  // 1c. Other Apple requirements from the past year or still upcoming
  const yearAgo = new Date(now.getTime() - 365 * DAY_MS);
  for (const req of requirements) {
    if (req === minTarget || /SDK minimum|^Xcode \d/i.test(req.title)) continue;
    if (new Date(req.date) < yearAgo) continue;
    const days = daysUntil(req.date, now);
    // Dated by month only: still ahead until the month is over, and no countdown to a day nobody announced
    const period = periodLabel(req);
    const pending = daysUntil(lastPossibleDay(req), now);
    const upcoming = pending !== null && pending >= 0;
    // What the date is: an expiry ("expires on"), a deadline to act by ("by January 31, 2026"), else when it starts
    const kind = /\bexpir/i.test(req.detail) ? 'expires' : new RegExp(`\\bby ${MONTH_PATTERN} \\d{1,2}, \\d{4}`).test(req.detail) ? 'by' : 'starts';
    // A deadline to act by that has passed asks nothing more
    if (!upcoming && kind === 'by') continue;
    const when = period ?? zhDate(req.date);
    const verb = kind === 'expires' ? '到期' : kind === 'by' ? '前須完成' : '起生效';
    const ahead = period ? `${when}${verb}（Apple 只公布月份，確切日期未定）` : `${when} ${verb}（${countdown(Math.max(0, days ?? 0))}）`;
    actions.push({
      status: upcoming ? deadlineStatus(Math.max(0, daysUntil(urgencyDay(req), now) ?? 0)) : 'ok',
      ...(upcoming ? { dueDate: urgencyDay(req) } : {}),
      title: `Apple 規定：${req.title.replace(/^Apple Developer News：/, '')}`,
      detail: `${upcoming ? ahead : kind === 'expires' ? `已於 ${when} 到期` : `自 ${when} 起生效`}。${req.detail}`,
      url: req.url,
    });
  }

  // 1d. Devices Xcode can no longer debug on
  if (latestXcode?.deviceiOS) {
    const deviceFloor = latestXcode.deviceiOS.match(/[\d.]+/)?.[0];
    const fallback = deviceFloor
      ? xcodeSupport.find(r => !/beta|RC/i.test(r.xcode) && r.deviceiOS
        && compareVersions(r.deviceiOS.match(/[\d.]+/)?.[0] ?? '0', deviceFloor) < 0)
      : undefined;
    actions.push({
      status: 'info',
      title: `Xcode ${latestXcode.xcode}：實機除錯需 iOS ${deviceFloor} 以上裝置`,
      detail: `Xcode ${latestXcode.xcode} 的部署版本範圍為 iOS ${latestXcode.deploymentiOS ?? '?'}，需 ${latestXcode.macOS.replace(/\s+or later$/i, ' 以上')}。`
        + (fallback ? `若要在更舊的實機上除錯，需保留 Xcode ${fallback.xcode}（支援 iOS ${fallback.deviceiOS?.replace(/\s+or later$/i, '')} 以上的裝置）。` : ''),
      url: 'https://developer.apple.com/xcode/system-requirements/',
    });
  }

  // 1e. Models Apple has announced that the device database doesn't list yet
  for (const device of announcedDevices) {
    actions.push({
      status: 'upcoming',
      title: `Apple 已公告新機型：${device.name}`,
      detail: `「${device.title}」（${device.date}）。新機型可能帶來新的螢幕尺寸或硬體功能，請確認版面與適配；上市資訊以 Apple 公告為準。`,
      url: device.url,
    });
  }

  // 1f. GitHub Actions: does macos-latest ship the Xcode you'll need?
  const latestRunner = ciRunners.find(r => r.labels.includes('macos-latest'));
  const stableXcode = toolchain?.xcodeStable;
  if (latestRunner?.defaultXcode && stableXcode && compareVersions(majorOf(latestRunner.defaultXcode) ?? '0', majorOf(stableXcode.version) ?? '0') < 0) {
    const withLatest = ciRunners.filter(r => r.status !== 'deprecated' && r.xcodes.some(x => majorOf(x) === majorOf(stableXcode.version) && !/beta/i.test(x)));
    actions.push({
      status: 'upcoming',
      title: `CI：GitHub Actions macos-latest 預設仍是 Xcode ${latestRunner.defaultXcode}`,
      detail: `最新穩定版為 Xcode ${stableXcode.label}。`
        + (withLatest.length
          ? `需要 Xcode ${majorOf(stableXcode.version)} 時，可改用 ${withLatest.map(r => `${r.label}${r.status === 'preview' ? '（預覽版）' : ''}`).join('、')} runner，並用 xcode-select 或 setup-xcode 指定版本。`
            + (withLatest.every(r => r.status === 'preview') ? '目前只有預覽版 runner 內建，正式環境可能需要自架 runner 或等映像檔更新。' : '')
          : `目前沒有正式（非 preview）的 GitHub runner 內建 Xcode ${majorOf(stableXcode.version)}，需等映像檔更新或改用自架 runner。`),
      url: latestRunner.url,
    });
  }

  // 2. New iPhone hardware → Xcode that knows about its iOS version
  const phones = toolchain?.newestiPhones ?? [];
  if (phones.length) {
    const iosVersion = phones[0].shipsWithiOS;
    // Only a major known ("27"): a model launched mid-cycle ships with a point release (iOS 27.1) and needs the
    // Xcode that adds it, so the newest stable Xcode of that major is the one to name, not its first
    const majorOnly = /^\d+$/.test(iosVersion);
    const xcode = majorOnly
      ? releases.filter(r => !r.isBeta && r.iosSdk && majorOf(r.iosSdk) === iosVersion).sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))[0]
        ?? minXcodeForiOSSdk(releases, iosVersion)
      : minXcodeForiOSSdk(releases, iosVersion);
    actions.push({
      status: 'info',
      title: `支援 ${phones.map(p => p.name).join(' / ')}`,
      detail: `出廠搭載 iOS ${iosVersion}${majorOnly ? '.x' : ''}（${phones[0].releaseDate} 上市${majorOnly ? '；確切版本以 Apple 公告為準' : ''}）。需使用 ${xcode ? xcodeRequirement(xcode) : `iOS ${iosVersion} SDK`}，才能在這些機型及模擬器上建置、執行與測試。`,
      url: xcode?.notesUrl,
    });
  }

  // 3. Debugging on devices running the current stable / beta iOS
  const stable = ios.find(v => !v.isBeta);
  const majorMinor = (v: string) => v.match(/^\d+(?:\.\d+)?/)?.[0];
  if (stable && majorMinor(stable.version)) {
    const xcode = minXcodeForiOSSdk(releases, majorMinor(stable.version)!);
    if (xcode) {
      actions.push({
        status: 'info',
        title: `在 iOS ${stable.version} 實機上除錯`,
        detail: `需要 ${xcodeRequirement(xcode)}。舊版 Xcode 無法把 App 安裝到這個版本的裝置上。`,
        url: xcode.notesUrl,
      });
    }
  }

  const beta = ios.find(v => v.isBeta);
  if (beta && majorMinor(beta.version)) {
    const xcode = minXcodeForiOSSdk(releases, majorMinor(beta.version)!);
    if (xcode) {
      actions.push({
        status: 'info',
        title: `測試 iOS ${beta.version}`,
        detail: `請使用 ${xcodeRequirement(xcode)}。`,
        url: xcode.notesUrl,
      });
    }
  }

  // 4. Minimum deployment target, from Apple's official usage share
  const deployment = adoption ? deploymentTargetAction(adoption) : null;
  if (deployment) actions.push(deployment);
  const taiwan = osShare ? minVersionAction('iOS', osShare) : null;
  if (taiwan) actions.push(taiwan);

  // 5. Server APIs Apple's documentation marks deprecated (no shutdown date yet: plan the move, nothing to meet)
  for (const d of deprecations) {
    actions.push({
      status: 'info',
      basis: 'official',
      title: `${d.name} 已被 Apple 標為淘汰`,
      detail: `Apple 文件已標示淘汰（自 ${d.deprecatedAt} 版起），尚未公布停止服務的日期；${d.replacement}。仍在使用的後端宜及早規劃遷移，公布日期後會列入期限時間軸。`,
      url: d.url,
    });
  }

  return byUrgency(actions);
}

/** Cumulative share for "this version or later", given shares ordered newest first */
function coverage(shares: iOSAdoption['allDevices']): Array<{ name: string; covered: number }> {
  let total = 0;
  return shares
    .map(s => ({ name: s.name, covered: (total += s.value) }))
    .filter(s => /^iOS \d+/.test(s.name));
}

function deploymentTargetAction(adoption: iOSAdoption): ActionItem | null {
  const all = coverage(adoption.allDevices);
  const recent = coverage(adoption.recentDevices);
  if (all.length < 2) return null;

  const [latest, previous] = all;
  const previousRecent = recent.find(r => r.name === previous.name);
  const measured = adoption.measuredAt ? `資料來源：Apple 官方，統計至 ${zhDate(adoption.measuredAt)}。` : '資料來源：Apple 官方。';
  return {
    status: 'info',
    basis: 'reference',
    title: `最低支援版本建議：${previous.name} 以上可涵蓋 ${previous.covered}% 裝置`,
    detail: `只支援 ${latest.name} 可涵蓋 ${latest.covered}% 的裝置；支援到 ${previous.name} 可涵蓋 ${previous.covered}%`
      + (previousRecent ? `（近四年推出的裝置為 ${previousRecent.covered}%）` : '')
      + `。${measured}`,
    url: 'https://developer.apple.com/support/app-store/',
  };
}

const COVERAGE_TARGET = 95;

/** Suggests the lowest major version whose "this or newer" share in Taiwan reaches COVERAGE_TARGET */
function minVersionAction(platform: 'iOS' | 'Android', osShare: OsShare): ActionItem | null {
  const key = platform === 'iOS' ? 'ios' : 'android';
  const tw = osShare[key].TW;
  if (!tw) return null;
  const pick = tw.coverage.find(c => c.covered >= COVERAGE_TARGET);
  if (!pick) return null;
  const ww = osShare[key].ww?.coverage.find(c => c.min === pick.min);
  const label = platform === 'iOS' ? `iOS ${pick.min}` : `Android ${pick.min}${pick.api ? `（API ${pick.api}）` : ''}`;
  const setting = platform === 'iOS' ? 'Deployment Target' : 'minSdk';
  return {
    status: 'info',
    basis: 'reference',
    title: `${setting} 參考：${label}${label.endsWith('）') ? '' : ' '}以上涵蓋台灣 ${pick.covered}% 裝置`,
    detail: `依 ${osShare.month} 台灣行動裝置的版本占比，支援到 ${label} 可涵蓋 ${pick.covered}%`
      + (ww ? `（全球 ${ww.covered}%）` : '') + `。各版本的完整分布見下方「版本分布」。資料來源：StatCounter。`,
    url: tw.url,
  };
}

const URGENCY: Record<ActionStatus, number> = { urgent: 0, upcoming: 1, info: 2, ok: 3 };

/** Most actionable first; items of equal urgency keep their original order */
function byUrgency(actions: ActionItem[]): ActionItem[] {
  return actions.map((a, i) => [a, i] as const).sort((x, y) => URGENCY[x[0].status] - URGENCY[y[0].status] || x[1] - y[1]).map(([a]) => a);
}

const PLATFORM_ZH: Array<[RegExp, string]> = [
  [/^new apps and app updates$/i, '新 App 與更新'],
  [/^existing apps$/i, '既有 App'],
  [/^Wear OS and Android Automotive OS$/i, 'Wear OS 與 Android Automotive OS'],
  [/^Android TV and Android XR$/i, 'Android TV 與 Android XR'],
  [/^iOS and iPadOS$/i, 'iOS 與 iPadOS'],
];

/** Translates the requirement labels scraped from Apple / Google; unknown labels pass through */
export function zhPlatform(platform: string): string {
  const existing = platform.match(/^Existing (.+) apps$/i);
  if (existing && !/^apps$/i.test(existing[1])) return `既有 ${zhPlatform(existing[1]).replace(/, /g, '、')} App`;
  return PLATFORM_ZH.find(([re]) => re.test(platform))?.[1] ?? platform.replace(/\band\b/g, '與');
}

/** "Android 16 (API level 36) or higher" → "Android 16（API 36）或更高" */
export function zhSdk(sdk: string): string {
  return sdk
    .replace(/\s*\(API\s+level\s+(\d+)\)/i, '（API $1）')
    // "API level 34 or higher" (a threshold Google gives by level only)
    .replace(/^API\s+level\s+(\d+)\s+or\s+higher$/i, 'API $1 或更高')
    .replace(/\s+or\s+higher$/i, '或更高')
    .replace(/\s+or\s+later$/i, ' 或更新版本')
    .replace(/\s+&\s+/g, ' 與 ');
}

function apiLevelOf(sdk: string): number | undefined {
  const level = sdk.match(/API\s+level\s+(\d+)/i)?.[1];
  return level ? Number(level) : undefined;
}

/**
 * A Play policy change in brief, in Chinese, with the replacement Google names in it: these are what an app has
 * to change. A change not recognised here is named as Google names it
 */
const POLICY_BRIEFS: Array<[RegExp, string]> = [
  [/Contact Picker/i, '聯絡人：不需要完整通訊錄的 App 須改用 Android Contact Picker'],
  [/location button/i, '精確位置：建議改用位置按鈕（location button）'],
  [/READ_CALL_LOG|Digital Credentials/i, '通話紀錄：不再允許用來驗證帳號，改用 Digital Credentials API 或 SMS Retriever API'],
  [/Geofence API|geofencing/i, '地理圍欄：不再是允許的前景服務用途，改用 Geofence API'],
  [/register (?:your|any remaining) (?:Play )?apps/i, '在 Play Console 首頁確認並註冊所有要繼續發布的 App'],
  [/anonymous (?:chat|and random chat)/i, '匿名／隨機聊天 App 的兒童與年齡限制規定擴大適用'],
];
function policyInBrief(p: Deadline): string {
  if (/^(?:Play 技術品質|Android 開發者驗證)：/.test(p.title)) return p.title.replace(/^[^：]+：/, '');
  return POLICY_BRIEFS.find(([re]) => re.test(p.detail))?.[1] ?? p.title.replace(/^Play 政策：/, '');
}

export function buildAndroidActions(
  android: OSVersionInfo[],
  deadline: SubmissionDeadline | null,
  extra: {
    toolchain?: AndroidToolchain | null;
    compat?: AndroidCompat | null;
    billing?: PlayBillingInfo;
    policies?: Deadline[];
    pageSize?: Deadline[];
    osShare?: OsShare | null;
    behaviorChanges?: BehaviorChanges | null;
  } = {},
  now = new Date(),
): ActionItem[] {
  const actions: ActionItem[] = [];
  const { toolchain = null, compat = null, billing, policies = [], pageSize = [], osShare = null, behaviorChanges = null } = extra;
  const toolsFor = (api: number) => {
    const row = compat?.apiLevels.find(r => Number(r.api) === api);
    return row ? `需要 AGP ${row.minAgp} 以上、Android Studio ${row.minStudio} 以上。` : '';
  };
  const stable = android.find(v => !v.isBeta);
  const targetSdkUrl = 'https://developer.android.com/google/play/requirements/target-sdk';

  // 1. Google Play target API level requirement
  const mainReq = deadline?.requirements.find(r => /new apps/i.test(r.platform)) ?? deadline?.requirements[0];
  const requiredApi = mainReq ? apiLevelOf(mainReq.sdk) : undefined;
  if (deadline && requiredApi) {
    const days = daysUntil(deadline.deadline, now);
    const extDays = deadline.extensionDate ? daysUntil(deadline.extensionDate, now) : null;
    const others = deadline.requirements
      .filter(r => r !== mainReq)
      .map(r => `${zhPlatform(r.platform)}：API ${apiLevelOf(r.sdk) ?? '?'}`)
      .join('、');
    const suffix = others ? `其他裝置類型 / 既有 App — ${others}。` : '';

    let status: ActionStatus;
    let when: string;
    if (days !== null && days >= 0) {
      status = deadlineStatus(days);
      when = `期限 ${zhDate(deadline.deadline)}（${countdown(days)}）`
        + (deadline.extensionDate ? `，可申請延長至 ${zhDate(deadline.extensionDate)}` : '') + '。';
    } else if (extDays !== null && extDays >= 0) {
      status = 'urgent';
      when = `原期限 ${zhDate(deadline.deadline)} 已過；已申請延長者至 ${zhDate(deadline.extensionDate!)}（${countdown(extDays)}）。`;
    } else {
      status = 'ok';
      when = `自 ${zhDate(deadline.deadline)} 起生效。`;
    }

    const due = days !== null && days >= 0 ? deadline.deadline : extDays !== null && extDays >= 0 ? deadline.extensionDate : undefined;
    actions.push({
      status,
      ...(due && calendarDate(due) ? { dueDate: calendarDate(due)! } : {}),
      title: `Google Play：新 App 與更新須將 targetSdk 設為 ${requiredApi}`,
      // What happens otherwise, where the extension is asked for, and who is exempt (Google's target API page)
      detail: `${when}${toolsFor(requiredApi)}${suffix}未達標的既有 App 對新使用者只提供給 Android 版本不高於其 targetSdk 的裝置（已安裝的使用者不受影響）；需要延長請在 Play Console 的延長申請表單提出；僅供內部發布的永久私人 App 不受此限。`,
      url: targetSdkUrl,
    });

    // An earlier deadline whose extension is still open when Google has already posted the next one
    for (const prior of deadline.earlier ?? []) {
      const api = apiLevelOf((prior.requirements.find(r => /new apps/i.test(r.platform)) ?? prior.requirements[0])?.sdk ?? '');
      const open = prior.extensionDate ? daysUntil(prior.extensionDate, now) : null;
      const passed = daysUntil(prior.deadline, now);
      if (!api || open === null || open < 0 || passed === null || passed >= 0) continue;
      actions.push({
        status: 'urgent',
        ...(calendarDate(prior.extensionDate!) ? { dueDate: calendarDate(prior.extensionDate!)! } : {}),
        title: `Google Play：targetSdk ${api} 的延長期即將結束`,
        detail: `原期限 ${zhDate(prior.deadline)} 已過；已申請延長者至 ${zhDate(prior.extensionDate!)}（${countdown(open)}）。下一個期限（targetSdk ${requiredApi}）見上一項。`,
        url: targetSdkUrl,
      });
    }

    // Play has required "latest major release minus one" every August 31
    const deadlineYear = new Date(deadline.deadline).getFullYear();
    if (status !== 'upcoming' && !Number.isNaN(deadlineYear)) {
      const nextApi = requiredApi + 1;
      // Use the real version name when the latest release has that API level; otherwise fall back to API − 20
      const nextMajor = stable && Number(stable.apiLevel) === nextApi ? majorOf(stable.version)! : String(nextApi - 20);
      actions.push({
        status: 'upcoming',
        title: `預計下一波：${deadlineYear + 1} 年 8 月 31 日前 targetSdk ${nextApi}（Android ${nextMajor}）`,
        detail: `Google Play 過去每年 8 月 31 日調高目標 API 等級，實際日期以 Google 公告為準。${toolsFor(nextApi)}請先檢視 targetSdk 設為 ${nextApi} 時會生效的 Android ${nextMajor} 行為變更`
          + (behaviorChanges?.major === nextMajor && behaviorChanges.changes.length
            ? `（${behaviorChanges.changes.length} 項）：${behaviorChanges.changes.slice(0, 6).join('、')}${behaviorChanges.changes.length > 6 ? ` 等 ${behaviorChanges.changes.length} 項` : ''}。`
            : '。'),
        url: `https://developer.android.com/about/versions/${nextMajor}/behavior-changes-${nextMajor}`,
        estimated: true,
      });
    }
  }

  // 1b. Play Billing Library: the oldest version whose deadline (or extension) hasn't passed yet
  // The library's own deadlines (the list also has the server-side Developer API shutdowns)
  const billingDue = (billing?.deadlines ?? [])
    .filter(d => /Billing Library \d+/.test(d.title))
    .filter(d => (daysUntil(d.extensionDate ?? d.date, now) ?? -1) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (billingDue) {
    const version = billingDue.title.match(/Library (\d+)/)?.[1];
    const days = daysUntil(billingDue.date, now)!;
    const extDays = billingDue.extensionDate ? daysUntil(billingDue.extensionDate, now) : null;
    const when = days >= 0
      ? `期限 ${zhDate(billingDue.date)}（${countdown(days)}）` + (billingDue.extensionDate ? `，可申請延長至 ${zhDate(billingDue.extensionDate)}` : '')
      : `原期限 ${zhDate(billingDue.date)} 已過；已申請延長者至 ${zhDate(billingDue.extensionDate!)}（${countdown(extDays!)}）`;
    actions.push({
      status: days >= 0 ? deadlineStatus(days) : 'urgent',
      dueDate: days >= 0 ? billingDue.date : billingDue.extensionDate,
      title: `Play Billing Library ${version} 以下須升級${billing?.latest ? `（最新 ${billing.latest}）` : ''}`,
      detail: `${when}。逾期後仍使用 PBL ${version} 以下的新 App 與更新將無法上架。先確認 AndroidManifest 裡 com.google.android.play.billingclient.version 的實際版本（manifest 合併可能把它移除，Play 因此判斷錯誤）；需要延長請在 Play Console 該警告的「政策狀態」頁提出。`,
      url: billingDue.url,
    });
  }

  // 1c. 16 KB memory page size support
  for (const d of pageSize) {
    const days = daysUntil(d.date, now);
    if (days === null || days < 0) continue;
    actions.push({
      status: deadlineStatus(days),
      dueDate: d.date,
      title: `${zhDate(d.date)} 起須支援 16 KB 記憶體分頁大小`,
      detail: `${countdown(days)}。適用 targetSdk 35 以上、在 64 位元裝置執行的 App。不支援 16 KB 分頁的 App 更新將無法發布；有 NDK / 原生函式庫（.so）或第三方 SDK 含原生程式碼的 App 需以 16 KB 對齊重新建置：最快的做法是升級到 AGP 8.5.1 以上與 NDK r28 以上（預設即 16 KB 對齊），再用 APK Analyzer、zipalign -c -P 16 或 check_elf_alignment.sh 檢查。`,
      url: d.url,
    });
  }

  // 1d. Upcoming Play policy changes, grouped by effective date
  const policyByDate = new Map<string, Deadline[]>();
  for (const p of policies) {
    // A requirement dated by month or year only stays listed until that period is over
    const days = daysUntil(lastPossibleDay(p), now);
    if (days === null || days < 0) continue;
    // A year-only and a January-only requirement share a date but not a wording
    const key = `${p.date}|${datePrecision(p)}`;
    policyByDate.set(key, [...(policyByDate.get(key) ?? []), p]);
  }
  for (const [key, list] of [...policyByDate].sort(([a], [b]) => a.localeCompare(b))) {
    const date = key.split('|')[0];
    const days = Math.max(0, daysUntil(date, now)!);
    // How urgent: from the day itself, a month's first day, or a year's last (as the timeline)
    const dueIn = daysUntil(urgencyDay(list[0]), now)!;
    // Each change in a few words with what to use instead, where the policy's own text says (else its name)
    const changes = [...new Set(list.map(policyInBrief))];
    const kind = list.every(p => /^Play 技術品質：/.test(p.title)) ? 'Google Play 技術品質要求'
      : list.every(p => /^Android 開發者驗證：/.test(p.title)) ? 'Android 開發者驗證'
      : list.every(p => /^Play 政策：/.test(p.title)) ? 'Google Play 政策' : 'Google Play 政策與要求';
    // Google gave only a month or a year: say that, not a day count to a day nobody announced
    const yearOnly = datePrecision(list[0]) === 'year';
    const monthOnly = datePrecision(list[0]) === 'month';
    const [y, m] = date.split('-').map(Number);
    const when = yearOnly ? `於 ${y} 年內` : monthOnly ? `自 ${y} 年 ${m} 月起` : `於 ${zhDate(date)} `;
    actions.push({
      status: deadlineStatus(dueIn),
      dueDate: urgencyDay(list[0]),
      title: `${list.length} 項 ${kind}將${when}生效`,
      detail: `${yearOnly || monthOnly ? `Google 只公布${yearOnly ? '年份' : '月份'}，確切日期未定` : countdown(days)}。${changes.join('；')}。詳見下方期限時間軸。`,
      // Several policy changes: the deadline table that lists them all, not the first one's own page
      url: list.length > 1 && list.every(p => p.source === 'Google Play Policy Deadlines') ? PLAY_POLICY_URL : list[0].url,
    });
  }

  // 1e. Latest Kotlin vs latest AGP / Gradle
  const kotlin = toolchain?.kotlin?.version;
  const kotlinRow = kotlin ? compat?.kotlin.find(r => {
    const [min, max] = r.kotlin.split('–');
    return compareVersions(kotlin, min) >= 0 && compareVersions(kotlin, max ?? min) <= 0;
  }) : undefined;
  if (kotlin && kotlinRow) {
    const agp = toolchain?.agpStable?.version;
    const gradle = toolchain?.gradle?.version;
    const agpTooNew = agp && compareVersions(agp, kotlinRow.agp[1]) > 0;
    const gradleTooNew = gradle && compareVersions(gradle, kotlinRow.gradle[1]) > 0;
    if (agpTooNew || gradleTooNew) {
      const parts = [agpTooNew && `AGP ${agp}`, gradleTooNew && `Gradle ${gradle}`].filter(Boolean).join('、');
      actions.push({
        status: 'upcoming',
        title: `相容性注意：Kotlin ${kotlin} 尚未正式支援 ${parts}`,
        detail: `Kotlin ${kotlin} 官方支援 AGP ${kotlinRow.agp.join('–')}、Gradle ${kotlinRow.gradle.join('–')}。升級到最新的 ${parts} 可能出現警告或建置問題，建議先留在支援範圍內，或等待新版 Kotlin。`,
        url: 'https://kotlinlang.org/docs/gradle-configure-project.html',
      });
    }
  }

  // 1f. minSdk: lowest version that still reaches ~95% of Taiwanese devices
  const minSdk = osShare ? minVersionAction('Android', osShare) : null;
  if (minSdk) actions.push(minSdk);

  // 2. Latest Android release affects every installed app, regardless of targetSdk
  const stableMajor = stable ? majorOf(stable.version) : undefined;
  if (stable && stableMajor) {
    actions.push({
      status: 'info',
      title: `測試 App 在 ${stable.version}${stable.apiLevel ? `（API ${stable.apiLevel}）` : ''}上的相容性`,
      detail: '部分行為變更會影響新系統上的所有 App，即使還沒調高 targetSdk 也一樣。',
      url: `https://developer.android.com/about/versions/${stableMajor}/behavior-changes-all`,
    });
  }

  const beta = android.find(v => v.isBeta);
  if (beta) {
    actions.push({
      status: 'info',
      title: `試用 ${beta.version}`,
      detail: '用最新的 Android Studio 預覽版搭配預覽 SDK 測試，及早發現相容性問題。',
      url: 'https://developer.android.com/about/versions',
    });
  }

  return byUrgency(actions);
}

/** Requirements from the past year and everything upcoming: upcoming first (soonest on top), then recent ones */
export function buildDeadlineTimeline(deadlines: Deadline[], now = new Date()): Deadline[] {
  const today = taipeiToday(now);
  const yearAgo = taipeiToday(new Date(now.getTime() - 365 * DAY_MS));
  // Still ahead until its extension, or (dated by month or year only) until that period is over
  const effectiveEnd = (d: Deadline) => [d.extensionDate ?? '', lastPossibleDay(d)].sort().at(-1)!;
  // Same first day: the exact date first, then the month, then the year (not interleaved)
  const RANK = { day: 0, month: 1, year: 2 } as const;
  const upcoming = deadlines.filter(d => effectiveEnd(d) >= today).sort((a, b) => a.date.localeCompare(b.date) || RANK[datePrecision(a)] - RANK[datePrecision(b)]);
  const recent = deadlines.filter(d => effectiveEnd(d) < today && d.date >= yearAgo).sort((a, b) => b.date.localeCompare(a.date));
  // How exact each date is, for API readers (the page reads it from the detail's own note)
  return [...upcoming, ...recent].map(d => {
    const precision = datePrecision(d);
    return precision === 'day' ? d : { ...d, datePrecision: precision };
  });
}
