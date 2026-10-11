import { minXcodeForiOSSdk } from './fetchers/ios-toolchain.js';
import { compareVersions } from './fetchers/ios-toolchain.js';
import type { PlayBillingInfo } from './fetchers/requirements.js';
import type { GithubMacosRunner } from './fetchers/ci-images.js';
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

const DAY_MS = 24 * 60 * 60 * 1000;
const URGENT_DAYS = 60;

function daysUntil(date: string, now: Date): number | null {
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - now.getTime()) / DAY_MS);
}

function countdown(days: number): string {
  if (days === 0) return '就是今天';
  if (days === 1) return '明天';
  return `剩 ${days} 天`;
}

/** "April 28, 2026" → "2026 年 4 月 28 日"; unparseable input is returned as-is */
export function zhDate(date: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
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
  } = {},
  now = new Date(),
): ActionItem[] {
  const actions: ActionItem[] = [];
  const releases = toolchain?.releases ?? [];
  const { adoption = null, xcodeSupport = [], requirements = [], announcedDevices = [], ciRunners = [] } = extra;

  // 1. App Store SDK requirement → which Xcode / macOS you need
  const iosReq = deadline?.requirements.find(r => /\biOS\b/.test(r.platform) || /\biOS\b/.test(r.sdk));
  const requiredSdk = iosReq?.sdk.match(/iOS\s+(\d+(?:\.\d+)?)/)?.[1];
  if (deadline && requiredSdk) {
    const xcode = minXcodeForiOSSdk(releases, requiredSdk);
    const days = daysUntil(deadline.deadline, now);
    const need = xcode ? xcodeRequirement(xcode) : `iOS ${requiredSdk} SDK`;
    const inEffect = days !== null && days < 0;
    actions.push({
      status: inEffect ? 'ok' : deadlineStatus(days ?? Infinity),
      title: `上架 App Store 必須使用 iOS ${requiredSdk} SDK 建置`,
      detail: inEffect
        ? `自 ${zhDate(deadline.deadline)} 起生效。最低需求：${need}。`
        : `${zhDate(deadline.deadline)} 起生效（${countdown(days!)}）。請升級至 ${need}。`,
      url: 'https://developer.apple.com/news/upcoming-requirements/',
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
    const upcoming = days !== null && days >= 0;
    actions.push({
      status: upcoming ? deadlineStatus(days!) : 'ok',
      title: `Apple 規定：${req.title}`,
      detail: `${upcoming ? `${zhDate(req.date)} 起生效（${countdown(days!)}）` : `自 ${zhDate(req.date)} 起生效`}。${req.detail}`,
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
      url: 'https://developer.apple.com/support/xcode/',
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
    const xcode = minXcodeForiOSSdk(releases, iosVersion);
    actions.push({
      status: 'info',
      title: `支援 ${phones.map(p => p.name).join(' / ')}`,
      detail: `出廠搭載 iOS ${iosVersion}（${phones[0].releaseDate} 上市）。需使用 ${xcode ? xcodeRequirement(xcode) : `iOS ${iosVersion} SDK`}，才能在這些機型及模擬器上建置、執行與測試。`,
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

  return actions;
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
    title: `最低支援版本建議：${previous.name} 以上可涵蓋 ${previous.covered}% 裝置`,
    detail: `只支援 ${latest.name} 可涵蓋 ${latest.covered}% 的裝置；支援到 ${previous.name} 可涵蓋 ${previous.covered}%`
      + (previousRecent ? `（近四年推出的裝置為 ${previousRecent.covered}%）` : '')
      + `。${measured}`,
    url: 'https://developer.apple.com/support/app-store/',
  };
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
  return PLATFORM_ZH.find(([re]) => re.test(platform))?.[1] ?? platform.replace(/\band\b/g, '與');
}

/** "Android 16 (API level 36) or higher" → "Android 16（API 36）或更高" */
export function zhSdk(sdk: string): string {
  return sdk
    .replace(/\s*\(API\s+level\s+(\d+)\)/i, '（API $1）')
    .replace(/\s+or\s+higher$/i, '或更高')
    .replace(/\s+or\s+later$/i, ' 或更新版本')
    .replace(/\s+&\s+/g, ' 與 ');
}

function apiLevelOf(sdk: string): number | undefined {
  const level = sdk.match(/API\s+level\s+(\d+)/i)?.[1];
  return level ? Number(level) : undefined;
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
  } = {},
  now = new Date(),
): ActionItem[] {
  const actions: ActionItem[] = [];
  const { toolchain = null, compat = null, billing, policies = [], pageSize = [] } = extra;
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
      when = `原期限 ${zhDate(deadline.deadline)} 已過；延長期限至 ${zhDate(deadline.extensionDate!)}（${countdown(extDays)}）。`;
    } else {
      status = 'ok';
      when = `自 ${zhDate(deadline.deadline)} 起生效。`;
    }

    actions.push({
      status,
      title: `Google Play：新 App 與更新須將 targetSdk 設為 ${requiredApi}`,
      detail: `${when}${toolsFor(requiredApi)}${suffix}`,
      url: targetSdkUrl,
    });

    // Play has required "latest major release minus one" every August 31
    const deadlineYear = new Date(deadline.deadline).getFullYear();
    if (status !== 'upcoming' && !Number.isNaN(deadlineYear)) {
      const nextApi = requiredApi + 1;
      // Use the real version name when the latest release has that API level; otherwise fall back to API − 20
      const nextMajor = stable && Number(stable.apiLevel) === nextApi ? majorOf(stable.version)! : String(nextApi - 20);
      actions.push({
        status: 'upcoming',
        title: `預計下一波：${deadlineYear + 1} 年 8 月 31 日前 targetSdk ${nextApi}（Android ${nextMajor}）`,
        detail: `Google Play 過去每年 8 月 31 日調高目標 API 等級，實際日期以 Google 公告為準。${toolsFor(nextApi)}請先檢視 targetSdk 設為 ${nextApi} 時會生效的 Android ${nextMajor} 行為變更。`,
        url: `https://developer.android.com/about/versions/${nextMajor}/behavior-changes-${nextMajor}`,
        estimated: true,
      });
    }
  }

  // 1b. Play Billing Library: the oldest version whose deadline (or extension) hasn't passed yet
  const billingDue = (billing?.deadlines ?? [])
    .filter(d => (daysUntil(d.extensionDate ?? d.date, now) ?? -1) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (billingDue) {
    const version = billingDue.title.match(/Library (\d+)/)?.[1];
    const days = daysUntil(billingDue.date, now)!;
    const extDays = billingDue.extensionDate ? daysUntil(billingDue.extensionDate, now) : null;
    const when = days >= 0
      ? `期限 ${zhDate(billingDue.date)}（${countdown(days)}）` + (billingDue.extensionDate ? `，可申請延長至 ${zhDate(billingDue.extensionDate)}` : '')
      : `原期限 ${zhDate(billingDue.date)} 已過；延長期限至 ${zhDate(billingDue.extensionDate!)}（${countdown(extDays!)}）`;
    actions.push({
      status: days >= 0 ? deadlineStatus(days) : 'urgent',
      title: `Play Billing Library ${version} 以下須升級${billing?.latest ? `（最新 ${billing.latest}）` : ''}`,
      detail: `${when}。逾期後仍使用 PBL ${version} 以下的新 App 與更新將無法上架。`,
      url: billingDue.url,
    });
  }

  // 1c. 16 KB memory page size support
  for (const d of pageSize) {
    const days = daysUntil(d.date, now);
    if (days === null || days < 0) continue;
    actions.push({
      status: deadlineStatus(days),
      title: `${zhDate(d.date)} 起須支援 16 KB 記憶體分頁大小`,
      detail: `${countdown(days)}。不支援 16 KB 分頁的 App 更新將無法發布；有 NDK / 原生函式庫（.so）或第三方 SDK 含原生程式碼的 App 需以 16 KB 對齊重新建置，可用 APK Analyzer 檢查。`,
      url: d.url,
    });
  }

  // 1d. Upcoming Play policy changes, grouped by effective date
  const policyByDate = new Map<string, Deadline[]>();
  for (const p of policies) {
    const days = daysUntil(p.date, now);
    if (days === null || days < 0) continue;
    policyByDate.set(p.date, [...(policyByDate.get(p.date) ?? []), p]);
  }
  for (const [date, list] of [...policyByDate].sort(([a], [b]) => a.localeCompare(b))) {
    const days = daysUntil(date, now)!;
    const names = [...new Set(list.map(p => p.title.replace(/^Play 政策：/, '')))];
    actions.push({
      status: deadlineStatus(days),
      title: `${list.length} 項 Google Play 政策將於 ${zhDate(date)} 生效`,
      detail: `${countdown(days)}。涉及：${names.join('、')}。詳見下方期限時間軸。`,
      url: list[0].url,
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

  return actions;
}

/** Requirements from the past year and everything upcoming: upcoming first (soonest on top), then recent ones */
export function buildDeadlineTimeline(deadlines: Deadline[], now = new Date()): Deadline[] {
  const today = now.toISOString().slice(0, 10);
  const yearAgo = new Date(now.getTime() - 365 * DAY_MS).toISOString().slice(0, 10);
  const effectiveEnd = (d: Deadline) => d.extensionDate && d.extensionDate > d.date ? d.extensionDate : d.date;
  const upcoming = deadlines.filter(d => effectiveEnd(d) >= today).sort((a, b) => a.date.localeCompare(b.date));
  const recent = deadlines.filter(d => effectiveEnd(d) < today && d.date >= yearAgo).sort((a, b) => b.date.localeCompare(a.date));
  return [...upcoming, ...recent];
}
