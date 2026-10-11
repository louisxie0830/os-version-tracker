# 免責聲明與智慧財產權聲明

最後更新：2026 年 10 月 11 日 · [English version](DISCLAIMER.en.md)

OS Version Tracker（以下稱「本網站」或「本專案」）是個人維護的開發者參考工具，網址為 <https://louisxie0830.github.io/os-version-tracker/>，原始碼位於 <https://github.com/louisxie0830/os-version-tracker>。本網站自動彙整公開資訊，協助 iOS 與 Android 開發者掌握系統版本、開發工具、上架規定與相容性。使用本網站或本專案，即表示你了解並同意以下內容。

## 1. 非官方網站

本網站為獨立的非官方專案，與下列任何公司、組織或銀行**均無隸屬、合作、贊助或背書關係**：Apple Inc.、Google LLC、JetBrains s.r.o.、Gradle Inc.、GitHub Inc.、Stack Exchange Inc.、StatCounter、Meta Platforms, Inc.、Airbnb, Inc.、Block, Inc.、Functional Software, Inc.（Sentry）、MongoDB, Inc.、Digital.ai，以及本網站提及的所有銀行、SDK 與服務供應商。

## 2. 商標

本網站與本專案提及的名稱與標誌均為其各自權利人所有，僅用於識別與說明，不代表權利人認可本網站，包括但不限於：

- **Apple**：Apple、iOS、iPadOS、macOS、watchOS、tvOS、visionOS、Xcode、Xcode Cloud、Swift、SwiftUI、iPhone、iPad、App Store、App Store Connect、TestFlight 為 Apple Inc. 的商標。
- **Google**：Android、Google Play、Play Console、Android Studio、Jetpack Compose、Firebase、Flutter 為 Google LLC 的商標。
- **開發工具與平台**：Kotlin 為 JetBrains s.r.o. 的商標；Gradle 為 Gradle Inc. 的商標；GitHub、GitHub Actions、GitHub Pages 為 GitHub Inc. 的商標；Stack Overflow 為 Stack Exchange Inc. 的商標；StatCounter 為 StatCounter 的商標。
- **SDK 與開源專案**：Facebook SDK、React Native（Meta Platforms, Inc.）、Lottie（Airbnb, Inc.）、OkHttp（Block, Inc.）、Glide、Coil、Sentry、Realm（MongoDB, Inc.）、Alamofire、SDWebImage、Kingfisher 等名稱屬於其各自的權利人或專案。
- **銀行**：本網站「台灣銀行 App 支援版本」區塊所涉及的各銀行名稱、行動銀行 App 名稱與標誌（網頁上以部分遮罩方式顯示），為各該銀行或其關係企業的商標或財產。
- 其他提及的產品、服務與公司名稱（例如 Slack、Discord、Docker、Render），其商標權均屬於各自的權利人。

## 3. 資料來源與引用內容的著作權

本網站顯示的資料由程式自動擷取自下列公開來源。**引用內容的著作權屬於原權利人**；本網站僅在說明、比較與研究所需的合理範圍內引用版本號、日期、標題或簡短摘錄，並附上原始連結與來源標示，完整內容請以原始網站為準。

| 類別 | 來源 |
|---|---|
| Apple 官方 | developer.apple.com（Developer News / Releases、Upcoming Requirements、Xcode 支援表、App Store 使用率、release notes、隱私清單文件）、gdmf.apple.com、www.apple.com、support.apple.com、itunes.apple.com、apps.apple.com |
| Google 官方 | developer.android.com、android-developers.googleblog.com、support.google.com（Play 政策）、play.google.com、dl.google.com（Google Maven、Android SDK repository） |
| 開發工具 | services.gradle.org、gradle.org、kotlinlang.org、repo1.maven.org、jb.gg（Android Studio 版本清單） |
| 第三方彙整 | xcodereleases.com、endoflife.date |
| 版本占比 | StatCounter Global Stats（gs.statcounter.com） |
| 社群 | GitHub（api.github.com、raw.githubusercontent.com、github.com）、Stack Exchange API（api.stackexchange.com） |

各來源的特別說明：

- **StatCounter Global Stats**：版本占比資料依 [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) 授權使用，資料來源標示為「StatCounter Global Stats」。該資料以 StatCounter 追蹤網站的流量估算，不代表實際裝置總數，也不代表任何特定 App 的使用者組成。
- **Stack Overflow**：問題標題與連結來自 Stack Exchange API。使用者貢獻內容依 [CC BY-SA](https://stackoverflow.com/help/licensing) 授權，著作權屬於原作者；本網站附上原文連結以標示出處。
- **GitHub**：SDK issue 標題來自各開源專案的公開 issue，著作權屬於原作者與各專案；GitHub Actions runner 映像資訊來自 actions/runner-images 專案。
- **App Store / Google Play**：銀行 App 的最低支援版本取自台灣區商店頁面公開顯示的資訊，可能因裝置、地區或 App 更新而不同，**不代表銀行的官方支援政策**，僅供業界參考。
- **xcodereleases.com、endoflife.date**：依其各自的使用條款引用。
- **Apple Developer Forums**：本網站只提供連結，不擷取其內容。

## 4. 本專案收錄的第三方素材

- **測試資料（`test/fixtures/`）**：為了自動化測試解析程式，本專案收錄了上述部分公開網頁、RSS 與 JSON 的**精簡副本**（移除導覽、樣式與程式碼，僅保留解析所需片段）。這些副本僅用於非商業的測試目的，著作權仍屬於原權利人；權利人如不同意收錄，請依第 8 節聯絡，我們會移除並改用自製的模擬資料。
- **Apple Root CA 憑證（`src/fetchers/apple-root-ca.ts`）**：為 Apple 公開發布的根憑證，取自 <https://www.apple.com/certificateauthority/>，僅用於驗證與 gdmf.apple.com 的 TLS 連線。
- **圖示與分享預覽圖**：本專案自行製作。

## 5. 本專案的著作權

本專案自行撰寫的程式碼、文字、頁面設計與圖示（不含第 2 至 4 節所述第三方內容與商標），著作權屬於本專案作者 Louis Xie。

本專案**目前未附開放原始碼授權條款（LICENSE）**。依著作權法，除法律允許的合理使用外，未經授權不得重製、改作或散布本專案原始碼；GitHub 服務條款允許的瀏覽與 fork 不在此限。若日後加入授權條款，以該條款為準。

## 6. 資訊正確性與免責

- 本網站資料由程式**自動抓取與解析**（網站每 30 分鐘更新一次），可能因來源網站改版、網路錯誤、快取或解析限制而**延遲、不完整或錯誤**。每個區塊都標示資料來源與抓取時間。
- 標示「**推估**」的項目依往年慣例推算（例如下一波 SDK 或 targetSdk 要求），並非官方公告；標示「**社群回報**」的閃退資訊來自 GitHub 與 Stack Overflow，未經官方確認。
- 「開發者須知」「我的專案檢查」與 Deployment Target / minSdk 建議，是依上述資料以固定規則推導的參考結果，**不保證適用於你的專案**。
- 本網站內容**僅供參考，不構成法律、法規遵循、資訊安全、財務或任何專業建議**。上架、版本支援、金融業法規遵循等決策，請以 Apple、Google 與主管機關的官方文件與公告為準，並自行評估或諮詢專業人士。
- 本網站以「現狀」及「現有」提供，不保證持續可用、不中斷、無錯誤或無安全漏洞。在法律允許的最大範圍內，本專案作者對因使用或無法使用本網站、或依賴本網站資訊所生的任何直接、間接、附帶、特殊或衍生損害（包括上架被拒、營運中斷或資料遺失），概不負責。
- 本網站連結的第三方網站由各自的經營者負責，其內容、可用性與隱私做法不在本網站控制範圍內。

## 7. 隱私

**本網站（GitHub Pages 上的靜態網站）：**

- **不使用 Cookie、不載入任何第三方程式、字型、廣告或分析追蹤工具，也不蒐集個人資料。**
- 你的瀏覽器只會向本網站本身請求頁面與資料檔（例如 `notifications.json`）；點擊外部連結時才會前往該網站。
- 下列資料**只儲存在你瀏覽器的 localStorage**，不會傳送到任何伺服器，可隨時透過清除網站資料刪除：
  - `project-config`：「我的專案檢查」輸入的版本號
  - `seen-items`：上次造訪看過的項目（用於「新」標示）
  - `notif-known`、`notif-read`：通知中心已知與已讀的項目
- Service Worker 會在瀏覽器的快取（Cache Storage）保存頁面、資料與圖示，用於離線瀏覽。
- 系統通知需由你主動授權，可隨時在瀏覽器設定中關閉。
- 網站託管於 GitHub Pages，GitHub 可能依其[隱私權聲明](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement)記錄存取日誌（例如 IP 位址）。
- 行事曆訂閱（`calendar.ics`）與 RSS（`feed.xml`）由你的行事曆或閱讀器向 GitHub Pages 讀取。

**公開發布的檔案：** 除頁面外，`api.json`、`notifications.json`、`calendar.ics`、`feed.xml`、`health.json`、`sitemap.xml`，以及用於跨次更新的 `state/changes.json`、`state/alerts.json` 皆為公開檔案，內容是彙整的公開資訊、項目首次出現時間與資料來源的健康狀態，**不含任何個人資料或金鑰**。

**自行部署本專案時：** 若設定 `NOTIFY_WEBHOOK_URL` 或 `ALERT_WEBHOOK_URL`，系統會把新項目的標題與連結、或資料來源的故障訊息傳送到你指定的 webhook；若設定 `GITHUB_TOKEN`，僅用於查詢 GitHub 公開 issue。這些設定與傳送內容由部署者自行負責，請勿把金鑰寫入程式碼或提交到版本庫。

## 8. 聯絡與移除

如需回報錯誤、提出權利主張或要求移除內容，請在 GitHub 開立 issue：
<https://github.com/louisxie0830/os-version-tracker/issues>

我們收到合理的權利通知後，會儘速移除或調整相關內容。

本聲明可能隨時更新，更新後於本網站與本專案公布即生效。

本聲明另有[英文版](DISCLAIMER.en.md)；中英文版本如有不一致，以中文版為準。
