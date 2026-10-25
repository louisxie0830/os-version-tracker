# OS Version Tracker

**iOS 與 Android 開發者的上架雷達**：最新系統版本，以及隨之而來的 Xcode、SDK、商店上架規定與相容性問題。

🔗 **網站：<https://louisxie0830.github.io/os-version-tracker/>**（每天自動更新兩次，可安裝成 PWA）

## 功能

| 區塊 | 內容 |
|---|---|
| 待處理 · 最新動態 | 待處理：會擋上架的規定、可能已遭利用的漏洞、提到最新系統的閃退回報；最新動態：新的上架規定、重要官方公告、新機型、SDK 閃退、資安公告、銀行 App 最低版本調整，可依類型與平台篩選；頂部搜尋涵蓋整頁（按 `/` 直接開始搜尋），每個區塊標題旁可複製該區塊的連結；可訂閱行事曆（.ics）與 RSS / Atom |
| 閃退與當機 | Apple / Android 官方 release notes 的已知問題與修正、18 個熱門 SDK repo 在 GitHub 近 30 天的閃退回報、Stack Overflow 近 90 天的社群討論，以及 Apple Developer Forums 捷徑 |
| Cordova 版本與閃退 | cordova-ios / cordova-android 最新版本、Node 需求、已知漏洞、目前大版本的破壞性變更與最新版修正（官方 RELEASENOTES.md）；7 個核心 plugin 的最新版、需要的平台版本（cordovaDependencies）與已知漏洞的受影響範圍及修正版本；以及平台與 7 個核心 plugin 在 GitHub 近半年的閃退、白屏、無法啟動回報；Cordova 官方公告併入開發者新聞 |
| React Native · Flutter | 兩個框架的最新正式版與近期各版本線；React Native 各版本 release notes 標示的破壞性變更、棄用與資安項目數，Flutter 內建的 Dart 版本；只列影響近期版本的已知漏洞 |
| 資安 | CISA KEV 近 180 天已遭利用的 iOS / Android / Chromium（WebView）漏洞、Apple 安全性更新（iOS、Safari、Xcode，標出可能已遭利用的 CVE）、每月 Android 安全性公告，以及 Cordova、React Native、OkHttp、Alamofire 等常用 SDK 在 GitHub Advisory Database 的資安公告；新的已遭利用漏洞會進通知中心 |
| 趨勢 | iOS / Android 各主版本在台灣與全球近 12 個月的占比變化（StatCounter 月資料，可切換地區）、台灣與全球的手機品牌占比，以及銀行 App 最低版本要求的分布變化（從開始記錄當天起每天累積）；圖表可滑過看數值、可切換為表格 |
| iOS / Android | 最新正式版與 Beta、開發者須知（上架期限換算成要升級的 Xcode / macOS、targetSdk 倒數、Deployment Target / minSdk 建議等）、開發工具版本、官方公告；iOS 區塊另有 Apple 開發者服務狀態（App Store Connect、TestFlight、APNs、Xcode Cloud 等近 7 天的事件，進行中的會列入「待處理」） |
| 版本分布 | 台灣與全球 iOS / Android 各版本占比、「支援到某版本可涵蓋多少裝置」、台灣最常見版本（StatCounter），以及 Apple 官方 iOS 採用率 |
| 銀行 App 支援版本 | 24 家銀行官方行動銀行 App 在 App Store / Google Play 標示的最低 iOS / Android 版本與 Android targetSdk（標出低於 Google Play 目前規定的 App），即時抓取；可依類型與版本篩選、排序；銀行調高或調低最低版本時會標示並發通知；銀行與 App 名稱以部分遮罩顯示 |
| 通知中心 | 右上角鈴鐺：新規定、重要公告、新機型、SDK 閃退、資安公告、銀行 App 版本調整、Apple 開發者服務事件的未讀清單；網頁開著時每 5 分鐘檢查，可開啟系統通知 |
| 相容性對照表 | Xcode × macOS × 部署版本 × 實機除錯、GitHub Actions macOS runner 內建的 Xcode、AGP × Gradle × JDK × Android Studio × Kotlin |
| 上架規定與期限 | App Store / Google Play 期限，以及 Apple Upcoming Requirements、Play 政策、Play Billing Library 淘汰、16 KB 分頁大小的時間軸 |
| 隱私規範 | Required Reason API 與原因代碼、須附隱私清單的第三方 SDK 名單、Apple 與 Google 官方文件 |

每個區塊都列出資料來源與抓取時間；依往年慣例推估的項目會標「推估」。

## 運作方式

```
push 到 master、手動觸發：驗證（Node 24＋覆蓋率門檻、Node 26）→ 抓取所有來源 → 產生網站 → 頁面檢查 → 部署
每天兩次的排程：             抓取所有來源 → 產生網站 → 頁面檢查（只警告）→ 部署
pull request：            驗證（Node 24＋覆蓋率門檻、Node 26）
```

驗證是同一份 `.github/workflows/ci.yml`：PR 直接執行，push 與手動觸發時由 `pages.yml` 呼叫，驗證沒過就不會建置與部署；每個 commit 只測一次。排程更新的程式碼已經驗證過，只跑建置與頁面檢查。

- 網站是純靜態檔案，不會休眠。
- 「首次出現時間」、未送達的通知與警報狀態存在 Actions cache，在各次執行之間延續（建置失敗也會保存）。
- 超過 40% 的來源抓取失敗時不發布，線上保留上一版。
- 網站先寫到 `site/` 旁邊的暫存資料夾，檢查必要檔案都在之後才替換 `site/`；建置中途失敗時原本的 `site/` 完整保留。替換時先把舊版改名為備份、新版改名進來、再刪備份，任何一步失敗都會把舊版放回；萬一中途當掉，下次建置會先從備份復原。暫存與備份資料夾的名稱記錄建立它的程序與時間；只有該程序還在、且建立不到 1 小時的才視為進行中（建置 job 上限 15 分鐘），所以 PID 被重複使用也不會讓舊資料夾一直留著。
- 頁面引用的 `style.css`、`theme.js`、`notifications.js`、元件腳本（`choice-chips.js`、`bank-table.js`、`trend-charts.js`）與 `app.js` 都帶 `?v=<檔案內容雜湊>`，內容一改網址就變，不會被舊快取擋住；service worker 對同一檔案的不同版本只保留最新一份離線副本。
- 所有對外請求都經過 `src/net.ts`：專案的 User-Agent、涵蓋內容下載的逾時、同一網站同時最多 4 個請求（名額保留到內容讀完、取消、出錯或逾時才釋放，釋放時直接交給排隊中的下一個）、遇到 429／502–504 或網路錯誤時重試一次（依 Retry-After 的秒數或日期等待，最多 10 秒）。`fetchText`／`fetchJson`／`fetchBytes` 把「請求＋讀完內容」當成一次嘗試，內容下載到一半斷線也會重試；JSON 格式錯誤、逾時、POST 不重試，所以單一來源最多等一次完整逾時。呼叫端可傳 `signal` 取消，排隊、等待重試或下載中都會立刻停止，錯誤維持 AbortError，與逾時錯誤不同。錯誤訊息只寫主機與路徑，不含 query string。例外（各有原因，測試會檢查清單）：webhook 與 GitHub issues API（網址或權杖是機密，且有自己的重試方式）、gdmf.apple.com 與 robots.txt 檢查（需要 Apple 根憑證，改用 `src/https-get.ts`：一個涵蓋 DNS、連線、標頭與完整內容的總期限、內容大小上限；gdmf 只對暫時性連線錯誤在同一個期限內重試一次）。同一個 feed 在一次更新中只下載一次，更新結束就不再共用。
- 跨次保存的狀態檔以原子方式寫入（先寫暫存檔、同步到磁碟、改名，再同步所在目錄；任何一步失敗都會清掉暫存檔、保留原檔）。讀取時會檢查結構：舊版缺少的欄位補預設值、型別錯誤的欄位或項目重設並在 log 列出欄位名稱（不含內容）；整個檔案無法使用時改名為 `.corrupt-` 備份並從空白開始。
- 每次建置的 Actions 執行頁面上有「資料來源」摘要表：每個來源的狀態（正常／不完整／失敗）、筆數、抓取時間與失敗原因，問題排在最前面。
- 資料來源失敗會自動開 issue「[資料來源失敗]」；抓取成功但資料不完整（例如某個欄位在少數 App 缺值、筆數比平常少一半以上）會開「[資料不完整]」，恢復後都會自動關閉。
- 每週一另外檢查首頁與 `legal/` 法律文件上的所有外部連結（`.github/workflows/links.yml`），失效的列在 issue「[外部連結失效] 網站」，每週更新、全部正常後關閉；擋自動請求的網站（如 Stack Overflow）略過不報。
- 同一個 workflow 也會用每個資料來源端點比對該網站的 robots.txt（`npm run check:robots`）：結果與每個 robots.txt 的快照保存為該次執行的 artifact（90 天）；新出現被禁止或讀不到的端點會開 issue「[robots.txt] 資料來源路徑被禁止」。robots.txt 最多讀 512 KiB（RFC 9309 的下限），轉址最多跟 5 次、不可換協定，超過或轉址網址無效都視為讀不到。已揭露的例外（dl.google.com）只記錄、不開 issue。
- 同一套程式也能以 Node 伺服器或 Docker 執行（見下方）。

## 本機開發

需要 Node.js 24 以上（`package.json` 的 `engines`）。

```bash
npm ci
npm run start:server      # 先 npm run build；或用 npx tsx watch src/server.ts 開發
npm test                  # 先 tsc 編譯（元件腳本），再跑解析器、通知、警報與前端元件的單元測試（以存下來的官方頁面為測試資料，不連網）
npm run test:coverage     # 同上，並檢查覆蓋率下限（行 90%、分支 84%、函式 86%；CI 會跑）
npm start                 # 在終端機印出版本與開發者須知
```

建置靜態網站（輸出到 `site/`）：

```bash
SITE_URL=https://louisxie0830.github.io/os-version-tracker npm run build:static
```

伺服器的最外層有錯誤邊界：無效的 request target 回 400，其他未預期的錯誤回 500（不含錯誤內容，安全標頭保留）；已經開始送出內容時改為中斷連線，不會寫出第二個回應。

伺服器模式提供：`/`、`/legal/`（免責聲明、英文版與資料來源合規清冊）、`/api`（或 `/api.json`）、`/api/*.json`（見下方 API）、`/calendar.ics`、`/feed.xml`、`/health`。`/health` 只讀取已快取的資料，回傳 `starting`／`ok`／`degraded` 與來源成功數，不會觸發抓取。

HTML、JSON、CSS、JavaScript、Atom 與 ICS 回應超過 1 KB 時，依 `Accept-Encoding` 以 Brotli 或 gzip 壓縮（Node 內建 zlib），並加上 `Vary: Accept-Encoding`；圖片不壓縮。協商遵守 q 值（只接受 0–1，`q=0` 表示拒絕）、`*` 與 `identity`，同權重時依 br、gzip、identity 的順序；所有可用的編碼（含 identity）都被拒絕時回 406；首選的壓縮失敗時改用下一個可接受的編碼，只有 identity 可接受時才送未壓縮內容，可接受的壓縮全部失敗則回 500。每種編碼的強 ETag 都是實際送出 bytes 的雜湊，`If-None-Match` 只會比對同一種編碼；壓縮結果依資料版本快取，同一份資料只壓縮一次。帶目前版本 `?v=` 的樣式表與腳本可永久快取，沒帶或版本過期的一律要求重新驗證。

## 環境變數

| 變數 | 用途 |
|---|---|
| `SITE_URL` | 網站公開網址（行事曆、feed、分享預覽圖使用）。靜態建置時必填 |
| `NOTIFY_WEBHOOK_URL` | 有新規定 / 重要公告 / 新機型時發送通知（Slack 相容的 `{ "text": ... }`），429 / 5xx 會重試 |
| `ALERT_WEBHOOK_URL` | 資料來源抓取或解析失敗時警報，只在開始失敗與恢復時各發一次 |
| `ALERT_GITHUB_ISSUES` | 設為 `1` 時，資料來源開始失敗或資料不完整會自動開 GitHub Issue、恢復時留言並關閉，外部連結檢查也會同步它的 issue（需 `GITHUB_TOKEN`、`GITHUB_REPOSITORY`；GitHub Actions 已預設開啟） |
| `GITHUB_TOKEN` | 選用。提高 GitHub 搜尋（SDK 與 Cordova 閃退回報）、Cordova 與 React Native release、SDK 資安公告查詢的速率限制；搭配 `ALERT_GITHUB_ISSUES` 時也用來開關警報 issue |
| `CHANGES_STATE_FILE` | 選用。伺服器模式下讓「首次出現時間」在重啟後保留 |
| `HISTORY_STATE_FILE` | 選用。伺服器模式下保留銀行 App 最低版本紀錄、上次通過檢查的核心版本與各來源筆數（資料完整度檢查用） |
| `PORT` | 伺服器埠號，預設 3000 |

GitHub Actions 中：`NOTIFY_WEBHOOK_URL`、`ALERT_WEBHOOK_URL` 設為 repository secrets；`SITE_URL` 可用 repository variable 覆寫（預設 `https://<owner>.github.io/<repo>`）。

## 部署

**GitHub Pages（目前使用）**：Settings → Pages → Source 選「GitHub Actions」，workflow 在 `.github/workflows/pages.yml`。GitHub 會停用 60 天沒有 commit 的 repo 的排程；兩個 workflow 都會在排程執行時透過 API 重新啟用自己，不需要手動處理。

**Docker**：

```bash
docker build -t os-version-tracker .
docker run -p 3000:3000 -e SITE_URL=https://example.com os-version-tracker
```

image 基於 Node 26 alpine（鎖定 digest）、以非 root 使用者執行、移除 npm 等執行時不需要的工具，並內建 HEALTHCHECK。程式不寫檔，可加 `--read-only --cap-drop=ALL --security-opt no-new-privileges` 執行。

### 頁面檢查

每次建置後，CI 會用無頭 Chrome 在 390、1100、1440px 三種寬度、淺色與深色模式，各載入一次首頁與 `legal/` 底下的三份法律文件，檢查：

- 版面：展開所有收合內容後，沒有元素超出畫面右緣
- 點擊：按鈕與連結沒有被其他元素蓋住，連結不會吃到所在列或卡片以外的點擊
- 功能：沒有 JS 錯誤；逐一操作所有篩選、排序、按鈕、搜尋與主題切換，篩選結果與計數一致
- 結構：沒有重複 id、失效的頁內錨點或 id 參照、缺少名稱的控制項、指向不存在檔案的連結
- 文字對比符合 WCAG AA
- 卡片裡的文字沒有貼著卡片邊緣（內容漏放在有內距的區塊外）

有任何問題就讓建置失敗，程式修改不會被部署；排程更新只會警告，不擋資料更新。檢查腳本在 `scripts/page-probe.js`。本機可執行：

```bash
npm run build:static && npm run check:page   # 需要 Chrome，可用 CHROME_PATH 指定
```

## API

靜態網站與伺服器模式提供相同的 JSON 端點，`api/index.json` 列出全部端點、說明與各資料來源的狀態。GitHub Pages 允許跨網域讀取，伺服器模式的 `/api/*.json` 也會回傳 `Access-Control-Allow-Origin: *`。

| 端點 | 內容 |
|---|---|
| `api/versions.json` | iOS、Android、Xcode 與 Android 開發工具的最新正式版與 Beta |
| `api/now.json` | 待處理項目（會擋上架的規定、可能已遭利用的漏洞、新系統閃退、目前有狀況的 Apple 開發者服務） |
| `api/actions.json` | iOS / Android 開發者須知 |
| `api/deadlines.json` | 上架規定與期限時間軸 |
| `api/feed.json` | 最新動態（含首次出現時間，`recent` 為近 7 天新增） |
| `api/security.json` | CISA KEV、Apple / Android 安全性更新、SDK 資安公告 |
| `api/crashes.json` | 閃退與當機 |
| `api/cordova.json` | Cordova 平台與 plugin 版本、平台需求、已知漏洞 |
| `api/frameworks.json` | React Native 與 Flutter 的最新正式版、近期版本線、release notes 標示的破壞性變更／棄用／資安項目數 |
| `api/compat.json` | Xcode、AGP、JDK、CI runner 相容性 |
| `api/trends.json` | 版本分布、近 12 個月主版本占比與手機品牌占比（StatCounter，CC BY-SA 3.0）、Apple iOS 採用率 |
| `api/banks.json` | 銀行 App 最低版本、Android targetSdk、版本調整紀錄、每日分布（名稱已遮罩） |
| `api/news.json` | 開發者新聞 |
| `api/status.json` | Apple 開發者服務近 7 天與進行中的事件（每天更新兩次，不是即時狀態） |
| `api/privacy.json` | Required Reason API 與須附隱私清單的 SDK |

每個端點的格式相同：

```json
{ "apiVersion": 1, "updatedAt": "2026-10-16T00:17:00.000Z", "sources": { "ios": { "label": "…", "url": "…", "fetchedAt": "…", "ok": true } }, "license": "…", "termsUrl": "https://…/legal/", "attribution": [{ "source": "ios", "licence": "…", "terms": ["…"] }], "data": { } }
```

`sources` 中 `ok: false` 表示該來源這次抓取失敗，`data` 可能不完整。`license`、`termsUrl`、`attribution` 是各來源的授權、條款與須標示的來源或作者，轉用資料時請一併保留。`api.json` 仍保留，一次回傳全部資料（沒有外層包裝）。

## 專案結構

```
src/
  fetchers/        各資料來源的抓取與解析（每個都有純函式 parseXxx，方便測試）
  fetch-all.ts     彙整所有來源、記錄抓取狀態（來源、時鐘、警報、通知、歷史紀錄都可注入，方便整合測試）
  insights.ts      由資料推導「開發者須知」
  changes.ts       新項目偵測、Atom feed、通知 webhook
  alerts.ts        來源失敗與資料不完整的警報
  quality.ts       資料完整度檢查（欄位缺漏、筆數驟降）
  android-api.ts   Android 版本與 API 等級的對應規則（不需每年補表）
  run-summary.ts   Actions 執行頁面上的「資料來源」摘要表
  calendar.ts      .ics 行事曆
  render.ts        頁面骨架；各區塊在 render-*.ts（feed、security、frameworks、platforms、schedule、trends、banks、docs、common）
  render-styles.ts 頁面樣式，輸出為 style.css（CSP 不允許行內樣式）
  render-actions.ts「開發者須知」清單；render-chart.ts 趨勢折線圖（SVG）
  api.ts           api/ 底下各主題的 JSON 端點
  source-registry.ts 資料來源合規清冊（端點、方式、條款、授權、風險），SOURCES.md 由它產生
  legal-pages.ts   把法律文件發布成網站上的 legal/ 頁面
  history.ts       銀行 App 版本、核心版本與各來源筆數的跨次紀錄
  check-page.ts    建置後的頁面檢查（搭配 scripts/page-probe.js）
  check-links.ts   每週外部連結檢查（首頁與法律文件）
  check-robots.ts  每週 robots.txt 檢查（所有資料來源端點）
  server.ts        Node 伺服器模式
  build-static.ts  靜態網站建置；publish-dir.ts 暫存資料夾建置與替換、復原
  asset-versions.ts 前端腳本的位置（唯一的解析器：元件來自 dist/browser/，其餘來自 public/）與內容版本（?v=）
  browser/         前端元件（choice-chips、bank-table、trend-charts，Light DOM custom elements）的 TypeScript 原始碼；
                   tsc 編譯成 dist/browser/*.js（一般 <script defer>，非 module），伺服器與靜態建置以網站根目錄的同名 .js 提供
public/            PWA manifest、service worker、圖示、手寫的前端腳本（theme.js、notifications.js、app.js）
scripts/           頁面檢查在瀏覽器裡執行的腳本
design/            分享預覽圖範本（og-image.html，不會部署）
test/              單元測試與 fixtures（存下來的官方頁面）
```

### 更新分享預覽圖

`public/og-image.png` 由 `design/og-image.html` 產生。改完範本後在 macOS 上執行（用系統的蘋方字型，換到其他系統字型會不同）：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --window-size=1200,630 --screenshot=public/og-image.png "file://$PWD/design/og-image.html"
```

Slack、LINE、Facebook 會快取預覽圖，已分享過的連結要等它們重新抓取（Facebook 可用 Sharing Debugger 手動更新）。

## 資料來源

共 26 個資料來源，每次建置的摘要表會逐一列出：StatCounter Global Stats（版本與手機品牌占比，CC BY-SA 3.0）、App Store / Google Play（台灣區）、Stack Exchange API、Apple（軟體更新目錄、Developer News / Releases、Upcoming Requirements、Xcode 支援表、App Store 採用率、release notes、安全性更新、隱私文件、開發者系統狀態）、Google（Android Developers Blog、Play 目標 API 等級、Play 政策期限、Play Billing 淘汰時程、16 KB 分頁指南、Android 安全性公告、AGP 相容性與 release notes、Android SDK repository、Google Maven、Flutter 官方版本清單）、CISA KEV、xcodereleases.com、endoflife.date、Gradle、Kotlin、npm registry、Swift.org、Firebase Blog、Apache Cordova、GitHub（actions/runner-images、熱門 SDK 與 Cordova issues、React Native releases、GitHub Advisory Database）。

免責聲明與智慧財產權：[中文](DISCLAIMER.md) · [English](DISCLAIMER.en.md)，網站上的版本在 `legal/`。相關文件：

- [SOURCES.md](SOURCES.md)：資料來源合規清冊，由 `src/source-registry.ts` 產生（改完執行 `npm run sources:doc`，測試會檢查是否過期）
- [DATA_LICENSE.md](DATA_LICENSE.md)：資料與引用內容的授權
- [LICENSE](LICENSE)：本專案保留所有權利
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)：相依套件的授權
- [SECURITY.md](SECURITY.md)：權利主張、個資請求與資安漏洞的私密回報方式

本專案以生成式 AI 工具（Claude Code）輔助開發，著作權歸屬與相關說明見免責聲明第 5 節。

所有資料皆來自公開頁面，以官方公告為準；GitHub 上的閃退回報為社群回報，未必已確認。
