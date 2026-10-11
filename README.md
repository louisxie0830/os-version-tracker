# OS Version Tracker

**iOS 與 Android 開發者的上架雷達**：最新系統版本，以及隨之而來的 Xcode、SDK、商店上架規定與相容性問題。

🔗 **網站：<https://louisxie0830.github.io/os-version-tracker/>**（每 30 分鐘自動更新，可安裝成 PWA）

## 功能

| 區塊 | 內容 |
|---|---|
| 最近 7 天新增 | 新的上架規定、重要官方公告、新機型、熱門 SDK 閃退；可訂閱行事曆（.ics）與 RSS / Atom |
| 我的專案檢查 | 輸入 Xcode、macOS、部署版本、AGP、Gradle、Kotlin、targetSdk、Billing 版本，列出會擋上架的項目與剩餘天數；結果網址可分享 |
| 近期閃退與當機 | Apple / Android 官方 release notes 的已知問題與修正、18 個熱門 SDK repo 在 GitHub 近 30 天的閃退回報、Stack Overflow 近 90 天的社群討論，以及 Apple Developer Forums 捷徑 |
| Apple iOS / Android | 最新正式版與 Beta、開發者須知（上架期限換算成要升級的 Xcode / macOS、targetSdk 倒數、Deployment Target / minSdk 建議等）、開發工具版本、官方公告 |
| 版本分布 | 台灣與全球 iOS / Android 各版本占比、「支援到某版本可涵蓋多少裝置」、台灣最常見版本（StatCounter），以及 Apple 官方 iOS 採用率 |
| 台灣銀行 App 支援版本 | 23 家銀行官方行動銀行 App 在 App Store / Google Play 標示的最低 iOS / Android 版本，即時抓取；銀行與 App 名稱以部分遮罩顯示 |
| 通知中心 | 右上角鈴鐺：新規定、重要公告、新機型、SDK 閃退的未讀清單；網頁開著時每 5 分鐘檢查，可開啟系統通知 |
| 版本相容性對照表 | Xcode × macOS × 部署版本 × 實機除錯、GitHub Actions macOS runner 內建的 Xcode、AGP × Gradle × JDK × Android Studio × Kotlin |
| 上架期限與規定 | App Store / Google Play 期限，以及 Apple Upcoming Requirements、Play 政策、Play Billing Library 淘汰、16 KB 分頁大小的時間軸 |
| 隱私清單與第三方 SDK | Required Reason API 與原因代碼、須附隱私清單的第三方 SDK 名單、Apple 與 Google 官方文件 |

每個區塊都列出資料來源與抓取時間；依往年慣例推估的項目會標「推估」。

## 運作方式

```
GitHub Actions（每 30 分鐘、push 到 master、或手動觸發）
  └─ npm test → 抓取所有官方來源 → 產生靜態網站 → 部署到 GitHub Pages
```

- 網站是純靜態檔案，不會休眠；「我的專案檢查」在瀏覽器中執行。
- 「首次出現時間」、未送達的通知與警報狀態存在 Actions cache，在各次執行之間延續（建置失敗也會保存）。
- 超過 40% 的來源抓取失敗時不發布，線上保留上一版。
- 同一套程式也能以 Node 伺服器或 Docker 執行（見下方）。

## 本機開發

需要 Node.js 24 以上。

```bash
npm ci
npm run start:server      # 先 npm run build；或用 npx tsx watch src/server.ts 開發
npm test                  # 解析器、通知與警報的單元測試（以存下來的官方頁面為測試資料）
npm start                 # 在終端機印出版本與開發者須知
```

建置靜態網站（輸出到 `site/`）：

```bash
SITE_URL=https://louisxie0830.github.io/os-version-tracker npm run build:static
```

伺服器模式提供：`/`、`/api`（或 `/api.json`）、`/calendar.ics`、`/feed.xml`、`/health`。

## 環境變數

| 變數 | 用途 |
|---|---|
| `SITE_URL` | 網站公開網址（行事曆、feed、canonical 連結使用）。靜態建置時必填 |
| `NOTIFY_WEBHOOK_URL` | 有新規定 / 重要公告 / 新機型時發送通知（Slack 相容的 `{ "text": ... }`），429 / 5xx 會重試 |
| `ALERT_WEBHOOK_URL` | 資料來源抓取或解析失敗時警報，只在開始失敗與恢復時各發一次 |
| `GITHUB_TOKEN` | 選用。提高 GitHub 搜尋（SDK 閃退回報）的速率限制 |
| `CHANGES_STATE_FILE` | 選用。伺服器模式下讓「首次出現時間」在重啟後保留 |
| `PORT` | 伺服器埠號，預設 3000 |

GitHub Actions 中：`NOTIFY_WEBHOOK_URL`、`ALERT_WEBHOOK_URL` 設為 repository secrets；`SITE_URL` 可用 repository variable 覆寫（預設 `https://<owner>.github.io/<repo>`）。

## 部署

**GitHub Pages（目前使用）**：Settings → Pages → Source 選「GitHub Actions」，workflow 在 `.github/workflows/pages.yml`。注意：repo 連續 60 天沒有 commit，GitHub 會停用排程，需到 Actions 頁面重新啟用。

**Docker**：

```bash
docker build -t os-version-tracker .
docker run -p 3000:3000 -e SITE_URL=https://example.com os-version-tracker
```

image 基於 Node 26 alpine（鎖定 digest）、以非 root 使用者執行、移除 npm 等執行時不需要的工具，並內建 HEALTHCHECK。程式不寫檔，可加 `--read-only --cap-drop=ALL --security-opt no-new-privileges` 執行。

## 專案結構

```
src/
  fetchers/        各資料來源的抓取與解析（每個都有純函式 parseXxx，方便測試）
  fetch-all.ts     彙整所有來源、記錄抓取狀態
  insights.ts      由資料推導「開發者須知」
  checker.ts       「我的專案檢查」規則（伺服器與瀏覽器共用）
  changes.ts       新項目偵測、Atom feed、通知 webhook
  alerts.ts        來源失敗警報
  calendar.ts      .ics 行事曆
  render.ts        頁面 HTML；render-actions.ts 為瀏覽器也能用的共用部分
  client/          瀏覽器端程式（專案檢查）
  server.ts        Node 伺服器模式
  build-static.ts  靜態網站建置
public/            PWA manifest、service worker、圖示
test/              單元測試與 fixtures（存下來的官方頁面）
```

## 資料來源

StatCounter Global Stats（版本占比，CC BY-SA 3.0）、App Store / Google Play（台灣區）、Stack Exchange API、Apple（軟體更新目錄、Developer News / Releases、Upcoming Requirements、Xcode 支援表、App Store 採用率、release notes、隱私文件）、Google（Android Developers Blog、Play 目標 API 等級、Play 政策期限、Play Billing 淘汰時程、16 KB 分頁指南、AGP 相容性與 release notes、Android SDK repository、Google Maven）、xcodereleases.com、endoflife.date、Gradle、Kotlin、GitHub（actions/runner-images、熱門 SDK issues）。

免責聲明與智慧財產權：[中文](DISCLAIMER.md) · [English](DISCLAIMER.en.md)（網頁最下方也有完整內容）。

所有資料皆來自公開頁面，以官方公告為準；GitHub 上的閃退回報為社群回報，未必已確認。
