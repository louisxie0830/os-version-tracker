import type { AllVersions } from './fetch-all.js';
import { compareVersions } from './fetchers/ios-toolchain.js';
import { zhDate } from './insights.js';
import type { ActionItem, ActionStatus, Deadline, UpgradeStep, XcodeSupportRow } from './types.js';

export interface ProjectConfig {
  xcode?: string;
  jdk?: string;
  macos?: string;
  deployment?: string;
  agp?: string;
  gradle?: string;
  kotlin?: string;
  targetSdk?: string;
  billing?: string;
  native?: boolean;
}

export const CONFIG_FIELDS = ['xcode', 'macos', 'deployment', 'jdk', 'agp', 'gradle', 'kotlin', 'targetSdk', 'billing'] as const;

const VERSION = /^\d+(?:\.\d+){0,3}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const URGENT_DAYS = 60;

/** Reads the checker form from query params; anything that isn't a plain version number is ignored */
export function parseConfig(params: URLSearchParams): ProjectConfig | null {
  const config: ProjectConfig = {};
  for (const field of CONFIG_FIELDS) {
    const value = params.get(field)?.trim();
    if (value && VERSION.test(value)) config[field] = value;
  }
  if (params.get('native') === '1') config.native = true;
  return Object.keys(config).length ? config : null;
}

const majorOf = (v: string) => Number(v.match(/^\d+/)?.[0] ?? NaN);
const majorMinor = (v: string) => v.match(/^\d+(?:\.\d+)?/)?.[0] ?? v;
const firstVersion = (text: string) => text.match(/\d+(?:\.\d+)+|\d+/)?.[0];

function daysUntil(date: string, now: Date): number {
  return Math.ceil((new Date(`${date}T00:00:00+08:00`).getTime() - now.getTime()) / DAY_MS);
}

function dueStatus(days: number): ActionStatus {
  return days <= URGENT_DAYS ? 'urgent' : 'upcoming';
}

/**
 * iOS SDK bundled with an Xcode version. Apple's support table covers recent releases;
 * older ones follow the long-standing mapping (Xcode 16 → iOS 18, 15 → 17 …; from 26 the numbers match).
 */
function sdkForXcode(xcode: string, rows: XcodeSupportRow[]): { sdk: string; estimated: boolean } {
  const row = rows.find(r => !/beta|RC/i.test(r.xcode) && compareVersions(firstVersion(r.xcode) ?? '0', xcode) === 0);
  if (row?.iosSdk) return { sdk: row.iosSdk, estimated: false };
  const major = majorOf(xcode);
  return { sdk: String(major >= 26 ? major : major + 2), estimated: true };
}

function stableRows(rows: XcodeSupportRow[]): XcodeSupportRow[] {
  return rows.filter(r => !/beta|RC/i.test(r.xcode));
}

function checkiOS(config: ProjectConfig, data: AllVersions, now: Date): ActionItem[] {
  const results: ActionItem[] = [];
  const rows = data.xcodeSupport;
  const latest = stableRows(rows)[0];
  const xcodeUrl = 'https://developer.apple.com/support/xcode/';

  // App Store SDK requirement
  const iosReq = data.appleDeadline?.requirements.find(r => /\biOS\b/.test(r.sdk));
  const requiredSdk = iosReq?.sdk.match(/iOS\s+(\d+)/)?.[1];
  if (config.xcode && requiredSdk) {
    const { sdk, estimated } = sdkForXcode(config.xcode, rows);
    const ok = majorOf(sdk) >= Number(requiredSdk);
    results.push({
      step: 'xcode', target: ok ? undefined : requiredSdk,
      status: ok ? 'ok' : 'urgent',
      title: ok
        ? `Xcode ${config.xcode}（iOS ${sdk} SDK）符合 App Store 上架要求`
        : `Xcode ${config.xcode} 無法上架：App Store 要求 iOS ${requiredSdk} SDK 以上`,
      detail: ok
        ? `目前規定自 ${zhDate(data.appleDeadline!.deadline)} 起須使用 iOS ${requiredSdk} SDK。`
        : `自 ${zhDate(data.appleDeadline!.deadline)} 起，須升級到 Xcode ${requiredSdk} 以上才能上傳到 App Store Connect。`,
      url: 'https://developer.apple.com/news/upcoming-requirements/',
      estimated,
    });

    // Next spring's requirement, once a newer stable SDK exists
    const nextMajor = latest?.iosSdk ? majorOf(latest.iosSdk) : NaN;
    if (ok && nextMajor > Number(requiredSdk) && majorOf(sdk) < nextMajor) {
      results.push({
        status: 'upcoming',
        step: 'xcode', target: String(nextMajor),
        title: `明年上架可能需要 Xcode ${nextMajor}（iOS ${nextMajor} SDK）`,
        detail: `Apple 過去每年 4 月左右要求使用最新 SDK。Xcode ${latest!.xcode} 需要 ${latest!.macOS.replace(/\s+or later$/i, ' 以上')}。`,
        url: xcodeUrl,
        estimated: true,
      });
    }

    // Debugging on the current stable iOS
    const stable = data.ios.find(v => !v.isBeta);
    if (stable && compareVersions(sdk, majorMinor(stable.version)) < 0) {
      results.push({
        status: 'info',
        step: 'xcode', target: majorMinor(stable.version),
        title: `Xcode ${config.xcode} 無法在 iOS ${stable.version} 實機上除錯`,
        detail: `需要 iOS SDK ${majorMinor(stable.version)} 以上的 Xcode。使用者已在用 iOS ${stable.version}，建議至少準備一台 CI 或開發機升級。`,
        url: xcodeUrl,
        estimated,
      });
    }
  }

  // CI / dev machine macOS
  if (config.macos && latest) {
    const needed = firstVersion(latest.macOS);
    if (needed && compareVersions(config.macos, needed) < 0) {
      const usable = stableRows(rows).find(r => {
        const min = firstVersion(r.macOS);
        return min && compareVersions(config.macos!, min) >= 0;
      });
      results.push({
        status: 'upcoming',
        step: 'macos', target: needed,
        title: `macOS ${config.macos} 無法安裝最新的 Xcode ${latest.xcode}`,
        detail: `Xcode ${latest.xcode} 需要 macOS ${needed} 以上。`
          + (usable ? `這台機器最高可用 Xcode ${usable.xcode}（iOS SDK ${usable.iosSdk ?? '?'}）。` : '這台機器在 Apple 支援表內找不到可用的 Xcode 版本。')
          + 'CI runner 也要一起規劃升級。',
        url: xcodeUrl,
      });
    } else if (needed) {
      results.push({
        status: 'ok',
        step: 'macos',
        title: `macOS ${config.macos} 可安裝最新的 Xcode ${latest.xcode}`,
        detail: `Xcode ${latest.xcode} 需要 macOS ${needed} 以上。`,
        url: xcodeUrl,
      });
    }
  }

  // Deployment target
  if (config.deployment) {
    const minTarget = data.timeline.find(d => d.platform === 'iOS' && /must target iOS \d+/i.test(d.detail));
    const required = minTarget?.detail.match(/must target iOS (\d+(?:\.\d+)?)/i)?.[1];
    if (required && compareVersions(config.deployment, required) < 0) {
      results.push({
        status: 'urgent',
        step: 'deployment', target: `iOS ${required}`,
        title: `部署版本 iOS ${config.deployment} 低於 App Store 最低要求 iOS ${required}`,
        detail: `自 ${zhDate(minTarget!.date)} 起，Deployment Target 低於 iOS ${required} 的 App 無法上傳。`,
        url: minTarget!.url,
      });
    }
    const floor = latest?.deploymentiOS?.split('–')[0];
    if (floor && compareVersions(config.deployment, floor) < 0) {
      results.push({
        status: 'upcoming',
        step: 'deployment', target: `iOS ${floor}`,
        title: `升級到 Xcode ${latest!.xcode} 前，需把部署版本提高到 iOS ${floor}`,
        detail: `Xcode ${latest!.xcode} 可設定的部署版本為 iOS ${latest!.deploymentiOS}，目前設定的 iOS ${config.deployment} 將無法建置。`,
        url: xcodeUrl,
      });
    }
    if (data.iosAdoption && (!required || compareVersions(config.deployment, required) >= 0) && (!floor || compareVersions(config.deployment, floor) >= 0)) {
      results.push({
        status: 'ok',
        step: 'deployment', basis: 'reference',
        title: `部署版本 iOS ${config.deployment} 符合上架與最新 Xcode 的要求`,
        detail: data.iosAdoption.measuredAt ? `可參考上方的 iOS 採用率（Apple 官方，統計至 ${zhDate(data.iosAdoption.measuredAt)}）決定是否提高。` : '可參考上方的 iOS 採用率決定是否提高。',
        url: 'https://developer.apple.com/support/app-store/',
      });
    }
  }

  return results;
}

function deadlineWindow(d: { date: string; extensionDate?: string }, now: Date): { status: ActionStatus; text: string } | null {
  const due = daysUntil(d.date, now);
  if (due >= 0) return { status: dueStatus(due), text: `期限 ${zhDate(d.date)}（剩 ${due} 天）${d.extensionDate ? `，可申請延長至 ${zhDate(d.extensionDate)}` : ''}` };
  if (d.extensionDate) {
    const ext = daysUntil(d.extensionDate, now);
    if (ext >= 0) return { status: 'urgent', text: `原期限 ${zhDate(d.date)} 已過；延長期限至 ${zhDate(d.extensionDate)}（剩 ${ext} 天）` };
  }
  return null;
}

function checkAndroid(config: ProjectConfig, data: AllVersions, now: Date): ActionItem[] {
  const results: ActionItem[] = [];
  const compat = data.androidCompat;
  const agpUrl = 'https://developer.android.com/build/releases/about-agp';

  // Google Play target API level
  const deadline = data.googleDeadline;
  const mainReq = deadline?.requirements.find(r => /new apps/i.test(r.platform)) ?? deadline?.requirements[0];
  const requiredApi = Number(mainReq?.sdk.match(/API\s+level\s+(\d+)/i)?.[1]);
  if (config.targetSdk && deadline && requiredApi) {
    const target = Number(config.targetSdk);
    if (target < requiredApi) {
      const window = deadlineWindow({ date: toIso(deadline.deadline), extensionDate: deadline.extensionDate ? toIso(deadline.extensionDate) : undefined }, now);
      results.push({
        status: window?.status ?? 'urgent',
        step: 'targetSdk', target: `API ${requiredApi}`,
        title: `targetSdk ${target} 不符合 Google Play 要求（API ${requiredApi}）`,
        detail: window ? `${window.text}。逾期後新 App 與更新將無法上架。` : `已生效，新 App 與更新無法上架，請盡快調高到 ${requiredApi}。`,
        url: 'https://developer.android.com/google/play/requirements/target-sdk',
      });
    } else {
      results.push({
        status: 'ok',
        step: 'targetSdk',
        title: `targetSdk ${target} 符合 Google Play 目前要求（API ${requiredApi}）`,
        detail: target === requiredApi ? `Google Play 過去每年 8 月 31 日調高一級，預計明年需要 API ${requiredApi + 1}。` : '已領先目前要求。',
        url: 'https://developer.android.com/google/play/requirements/target-sdk',
        estimated: target === requiredApi,
      });
    }

    // AGP must know about the API level you target
    const apiRow = compat?.apiLevels.find(a => Number(a.api) === Math.max(target, requiredApi));
    if (config.agp && apiRow && compareVersions(config.agp, apiRow.minAgp) < 0) {
      results.push({
        status: 'urgent',
        step: 'agp', target: apiRow.minAgp,
        title: `AGP ${config.agp} 不支援 API ${apiRow.api}`,
        detail: `targetSdk ${apiRow.api} 需要 AGP ${apiRow.minAgp} 以上、Android Studio ${apiRow.minStudio} 以上。`,
        url: agpUrl,
      });
    }
  }

  // JDK: what the project's AGP needs, and what the latest AGP will need
  if (config.jdk) {
    const jdkFor = (agp?: string) => agp
      ? data.agpJdk.find(j => j.agp === majorMinor(agp))?.jdk ?? (compat?.current.agp === majorMinor(agp) ? compat.current.jdk : undefined)
      : undefined;
    const needed = jdkFor(config.agp);
    const latestAgp = compat?.current.agp;
    const latestNeeded = compat?.current.jdk;
    if (needed && compareVersions(config.jdk, needed) < 0) {
      results.push({
        step: 'jdk', target: needed,
        status: 'urgent',
        title: `JDK ${config.jdk} 無法執行 AGP ${config.agp}（需要 JDK ${needed}）`,
        detail: '請先升級 CI 與開發機的 JDK，再調整 Gradle / AGP。',
        url: 'https://developer.android.com/build/jdks',
      });
    } else if (latestNeeded && compareVersions(config.jdk, latestNeeded) < 0) {
      results.push({
        step: 'jdk', target: latestNeeded,
        status: 'upcoming',
        title: `升級到 AGP ${latestAgp} 需要 JDK ${latestNeeded}`,
        detail: `目前的 JDK ${config.jdk}${needed ? ` 可執行 AGP ${config.agp}` : ''}，但升級到最新 AGP 前必須先升級 JDK。`,
        url: 'https://developer.android.com/build/jdks',
      });
    } else if (needed || latestNeeded) {
      results.push({
        step: 'jdk',
        status: 'ok',
        title: `JDK ${config.jdk} 符合 AGP 需求`,
        detail: `${needed ? `AGP ${config.agp} 需要 JDK ${needed}` : ''}${needed && latestNeeded ? '；' : ''}${latestNeeded ? `最新 AGP ${latestAgp} 需要 JDK ${latestNeeded}` : ''}。`,
        url: 'https://developer.android.com/build/jdks',
      });
    }
  }

  // AGP ↔ Gradle
  if (config.agp && compat) {
    const row = compat.agpGradle.find(r => r.agp === majorMinor(config.agp!));
    if (row && config.gradle) {
      const ok = compareVersions(config.gradle, row.minGradle) >= 0;
      results.push({
        status: ok ? 'ok' : 'urgent',
        step: 'gradle', target: ok ? undefined : row.minGradle,
        title: ok ? `AGP ${config.agp} 與 Gradle ${config.gradle} 相容` : `AGP ${config.agp} 需要 Gradle ${row.minGradle} 以上`,
        detail: ok ? `AGP ${row.agp} 最低需要 Gradle ${row.minGradle}。` : `目前的 Gradle ${config.gradle} 會導致建置失敗，請更新 gradle-wrapper.properties。`,
        url: agpUrl,
      });
    } else if (!row) {
      results.push({
        status: 'info',
        step: 'agp',
        title: `相容性表內找不到 AGP ${majorMinor(config.agp)}`,
        detail: '可能是過舊或尚未發布的版本，請對照下方相容性表。',
        url: agpUrl,
      });
    }

    const stableAgp = data.androidToolchain?.agpStable?.version;
    if (stableAgp && compareVersions(majorMinor(config.agp), majorMinor(stableAgp)) < 0) {
      results.push({
        status: 'info',
        step: 'agp',
        title: `AGP 最新穩定版為 ${stableAgp}`,
        detail: `目前使用 ${config.agp}。升級前請先確認 Kotlin、Gradle 與 Android Studio 版本（見下方相容性表）。`,
        url: 'https://developer.android.com/build/releases/gradle-plugin',
      });
    }
  }

  // Kotlin ↔ AGP / Gradle
  if (config.kotlin && compat) {
    const row = compat.kotlin.find(k => {
      const [min, max] = k.kotlin.split('–');
      return compareVersions(config.kotlin!, min) >= 0 && compareVersions(config.kotlin!, max ?? min) <= 0;
    });
    if (row) {
      const problems = [
        config.agp && (compareVersions(config.agp, row.agp[0]) < 0 || compareVersions(config.agp, row.agp[1]) > 0) && `AGP ${config.agp}（支援 ${row.agp.join('–')}）`,
        config.gradle && (compareVersions(config.gradle, row.gradle[0]) < 0 || compareVersions(config.gradle, row.gradle[1]) > 0) && `Gradle ${config.gradle}（支援 ${row.gradle.join('–')}）`,
      ].filter(Boolean);
      results.push(problems.length
        ? {
          status: 'upcoming',
          step: 'kotlin',
          title: `Kotlin ${config.kotlin} 未正式支援目前的建置工具`,
          detail: `超出官方支援範圍：${problems.join('、')}。可能出現警告或建置問題。`,
          url: 'https://kotlinlang.org/docs/gradle-configure-project.html',
        }
        : {
          status: 'ok',
          step: 'kotlin',
          title: `Kotlin ${config.kotlin} 與 AGP / Gradle 相容`,
          detail: `官方支援 AGP ${row.agp.join('–')}、Gradle ${row.gradle.join('–')}。`,
          url: 'https://kotlinlang.org/docs/gradle-configure-project.html',
        });
    } else {
      results.push({
        status: 'info',
        step: 'kotlin',
        title: `Kotlin 相容性表內找不到 ${config.kotlin}`,
        detail: '可能是過舊或預覽版本，請對照 Kotlin 官方相容性表。',
        url: 'https://kotlinlang.org/docs/gradle-configure-project.html',
      });
    }
  }

  // Play Billing Library
  if (config.billing) {
    const major = majorOf(config.billing);
    const row = data.timeline.find(d => d.title.startsWith(`Play Billing Library ${major} `));
    const latest = data.timeline.map(d => d.detail.match(/最新版本為 ([\d.]+)/)?.[1]).find(Boolean);
    const window = row ? deadlineWindow(row, now) : null;
    if (row && window) {
      results.push({
        status: window.status,
        step: 'billing', target: latest,
        title: `Play Billing Library ${major} 即將停止支援`,
        detail: `${window.text}。逾期後新 App 與更新將無法上架${latest ? `，最新版本為 ${latest}` : ''}。`,
        url: row.url,
      });
    } else if (row && daysUntil(row.extensionDate ?? row.date, now) < 0) {
      results.push({
        status: 'urgent',
        step: 'billing', target: latest,
        title: `Play Billing Library ${major} 已停止支援`,
        detail: `期限已於 ${zhDate(row.extensionDate ?? row.date)} 截止，新 App 與更新無法上架${latest ? `，請升級到 ${latest}` : ''}。`,
        url: row.url,
      });
    } else {
      const oldest = data.timeline
        .filter(d => d.title.startsWith('Play Billing Library'))
        .map(d => majorOf(d.title.replace('Play Billing Library ', '')))
        .sort((a, b) => a - b)[0];
      results.push(oldest !== undefined && major < oldest
        ? { status: 'urgent', step: 'billing', target: latest, title: `Play Billing Library ${major} 已停止支援`, detail: `新 App 與更新無法上架${latest ? `，請升級到 ${latest}` : ''}。`, url: 'https://developer.android.com/google/play/billing/deprecation-faq' }
        : { status: 'ok', step: 'billing', title: `Play Billing Library ${major} 目前不在淘汰名單`, detail: latest ? `最新版本為 ${latest}。` : '', url: 'https://developer.android.com/google/play/billing/deprecation-faq' });
    }
  }

  // 16 KB page size
  if (config.native) {
    const pageSize = data.timeline.find(d => /16 KB/.test(d.title) && daysUntil(d.date, now) >= 0);
    if (pageSize) {
      const days = daysUntil(pageSize.date, now);
      results.push({
        status: dueStatus(days),
        step: 'ndk', target: '16 KB 對齊',
        title: `含原生程式碼：${zhDate(pageSize.date)} 前須支援 16 KB 分頁大小`,
        detail: `剩 ${days} 天。請以 NDK r28 以上（或 16 KB 對齊）重新建置 .so，並確認第三方 SDK 已支援，可用 APK Analyzer 檢查。`,
        url: pageSize.url,
      });
    }
  }

  return results;
}

function toIso(date: string): string {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? date
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const ORDER: Record<ActionStatus, number> = { urgent: 0, upcoming: 1, info: 2, ok: 3 };

/** The order upgrades have to happen in: each step's tooling requires the previous one */
export const UPGRADE_ORDER: Record<'ios' | 'android', UpgradeStep[]> = {
  ios: ['macos', 'xcode', 'deployment'],
  android: ['jdk', 'gradle', 'agp', 'kotlin', 'targetSdk', 'billing', 'ndk'],
};

export const STEP_LABEL: Record<UpgradeStep, string> = {
  macos: 'macOS', xcode: 'Xcode', deployment: 'Deployment Target',
  jdk: 'JDK', gradle: 'Gradle', agp: 'AGP', kotlin: 'Kotlin', targetSdk: 'targetSdk', billing: 'Play Billing', ndk: '原生程式碼',
};

export interface PlanStep {
  step: UpgradeStep;
  label: string;
  target?: string;
  status: ActionStatus;
}

/** Steps that need action (urgent or upcoming), in dependency order, with the version to move to */
export function upgradePlan(items: ActionItem[], platform: 'ios' | 'android'): PlanStep[] {
  return UPGRADE_ORDER[platform].flatMap(step => {
    const pending = items.filter(i => i.step === step && (i.status === 'urgent' || i.status === 'upcoming'));
    if (!pending.length) return [];
    const urgent = pending.find(i => i.status === 'urgent');
    const target = (urgent ?? pending[0]).target ?? pending.find(i => i.target)?.target;
    return [{ step, label: STEP_LABEL[step], target, status: urgent ? 'urgent' : 'upcoming' }];
  });
}

export function checkProject(config: ProjectConfig, data: AllVersions, now = new Date()): { ios: ActionItem[]; android: ActionItem[] } {
  const sort = (items: ActionItem[]) => items.sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  return { ios: sort(checkiOS(config, data, now)), android: sort(checkAndroid(config, data, now)) };
}

export type { Deadline };
