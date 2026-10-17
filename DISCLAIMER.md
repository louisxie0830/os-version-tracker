# 免責聲明與智慧財產權聲明

最後更新：2026 年 10 月 17 日 · [English version](DISCLAIMER.en.md)

OS Version Tracker（以下稱「本網站」或「本專案」）是由個人（以下稱「作者」）以個人身分維護的非營利開發者參考工具，網址為 <https://louisxie0830.github.io/os-version-tracker/>，原始碼位於 <https://github.com/louisxie0830/os-version-tracker>。本網站自動彙整公開資訊，協助 iOS 與 Android 開發者掌握系統版本、開發工具、上架規定與相容性。使用本網站、API 或本專案前，請先閱讀以下內容。

## 1. 非官方網站

本網站為獨立的非官方專案，與下列任何公司、組織或銀行**均無隸屬、合作、贊助或背書關係**：Apple Inc.、Google LLC、JetBrains s.r.o.、Gradle Inc.、GitHub Inc.、Stack Exchange Inc.、StatCounter、Meta Platforms, Inc.、Airbnb, Inc.、Block, Inc.、Functional Software, Inc.（Sentry）、MongoDB, Inc.，以及本網站提及的所有銀行、SDK 與服務供應商。

本網站不代表作者任職或往來之任何公司、金融機構或組織的立場，也不是任何機構的官方資訊。本網站所有資料僅來自第 3 節所列的公開資訊，不包含任何機構的內部、機密或非公開資訊。

## 2. 商標

本網站與本專案提及的名稱與標誌均為其各自權利人所有，僅用於識別與說明，不代表權利人認可本網站，包括但不限於：

- **Apple**：Apple、iOS、iPadOS、macOS、watchOS、tvOS、visionOS、Xcode、Xcode Cloud、Swift、SwiftUI、iPhone、iPad、App Store、App Store Connect、TestFlight 為 Apple Inc. 的商標。
- **Google**：Android、Google Play、Play Console、Android Studio、Jetpack Compose、Firebase、Flutter 為 Google LLC 的商標。
- **開發工具與平台**：Kotlin 為 JetBrains s.r.o. 的商標；Gradle 為 Gradle Inc. 的商標；GitHub、GitHub Actions、GitHub Pages 為 GitHub Inc. 的商標；Stack Overflow 為 Stack Exchange Inc. 的商標；StatCounter 為 StatCounter 的商標。
- **SDK 與開源專案**：Facebook SDK、React Native（Meta Platforms, Inc.）、Lottie（Airbnb, Inc.）、OkHttp（Block, Inc.）、Glide、Coil、Sentry、Realm（MongoDB, Inc.）、Alamofire、SDWebImage、Kingfisher 等名稱屬於其各自的權利人或專案。
- **銀行**：本網站「台灣銀行 App 支援版本」區塊所涉及的各銀行名稱、App 名稱與標誌（網頁上以部分遮罩方式顯示），為各該銀行或其關係企業的商標或財產。
- 其他提及的產品、服務與公司名稱（例如 Slack、Discord、Docker、Render），其商標權均屬於各自的權利人。

## 3. 資料來源與引用內容的著作權

本網站顯示的資料由程式自動擷取自下列公開來源。**引用內容的著作權屬於原權利人**，完整內容請以原始網站為準。不同內容的使用依據不同，本網站分別處理，而不是一律主張合理使用：

- **事實資訊**（版本號、日期、API 等級、期限等）：單純的事實不受著作權保護。
- **採開放授權的內容**：依各自授權使用並標示，例如 StatCounter（CC BY-SA 3.0）、Stack Overflow（CC BY-SA）、GitHub Advisory Database（CC BY 4.0）、CISA KEV（CC0 1.0）、Apache Cordova release notes（Apache 2.0）。
- **其他標題與簡短摘錄**（新聞與公告標題、GitHub issue 標題）：只在說明與比較所需的範圍內引用，標示出處、作者（可得時）並附原始連結（台灣著作權法第 52 條、第 64 條）；不轉載全文。

每個來源的端點、擷取方式、條款、授權與風險評估，列在[資料來源合規清冊](SOURCES.md)；授權摘要見 [DATA_LICENSE.md](DATA_LICENSE.md)。

本網站的擷取方式：只讀取公開、不需登入的頁面、feed 與 API，依排程每天兩次（程式更新或手動重建時會額外執行），並以可識別的 User-Agent 標示本專案；不規避任何登入、付費牆、技術保護措施或存取限制，也不重新發布原始網頁的完整內容。截至最後檢查日，除下述例外外，已檢查的列示路徑都未被各網站的 robots.txt 禁止；robots.txt 隨時可能改變，也不等於法律上的授權，每週會自動重新檢查並保存結果與快照。**例外**：dl.google.com（Google Maven 與 Android SDK repository）的 robots.txt 禁止所有程式讀取，本網站仍讀取其中少數固定的版本中繼資料檔（AGP、Compose BOM、Play Billing 與 Android SDK 平台版本），因為這些檔案是供 Gradle、Android Studio 等建置工具自動讀取的套件庫資料；清冊中標為高風險並說明理由，Google 如反對會停止讀取。**其中部分 Apple 來源**（上架規定、Xcode 支援表、App Store 使用率、安全性更新、隱私文件、release notes、開發者系統狀態與軟體更新目錄）是網頁或網頁背後的資料，Apple 的網站使用條款限制以自動方式取得「非刻意提供」的內容；本網站只從中擷取事實資訊並附原始連結，清冊中標為高風險。來源網站的權利人或經營者如不同意本網站擷取或引用，請依第 8 節聯絡，作者會停止擷取並移除相關內容。

| 類別 | 來源 |
|---|---|
| Apple 官方 | developer.apple.com（Developer News / Releases、Upcoming Requirements、Xcode 支援表、App Store 使用率、release notes、隱私清單文件、Xcode Cloud release notes）、www.apple.com（開發者系統狀態）、support.apple.com（安全性更新）、gdmf.apple.com（軟體更新目錄）、itunes.apple.com（iTunes Lookup API）、apps.apple.com（只提供連結） |
| Google 官方 | developer.android.com（含 Android Developers Blog 與 AndroidX feed）、source.android.com（Android 安全性公告）、support.google.com（Play 政策）、play.google.com（商店頁）、dl.google.com（Google Maven、Android SDK repository）、storage.googleapis.com（Flutter 官方版本清單）、androidstudio.googleblog.com |
| 開發工具 | services.gradle.org、gradle.org、kotlinlang.org、repo1.maven.org、jb.gg（Android Studio 版本清單）、registry.npmjs.org（npm） |
| 開發者新聞 | www.swift.org、blog.jetbrains.com（Kotlin Blog）、firebase.blog、cordova.apache.org，以及上列 Apple 與 Google 的官方 feed；新聞標題維持原文並連回原始文章 |
| 資安 | www.cisa.gov（CISA KEV）、GitHub Advisory Database（api.github.com） |
| 第三方彙整 | xcodereleases.com、endoflife.date |
| 版本與品牌占比 | StatCounter Global Stats（gs.statcounter.com） |
| 社群與開源專案 | GitHub（api.github.com、raw.githubusercontent.com、github.com）、Stack Exchange API（api.stackexchange.com） |

各來源的特別說明：

- **StatCounter Global Stats**：版本占比資料依 [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) 授權使用，資料來源標示為「StatCounter Global Stats」。手機品牌占比同樣來自 StatCounter、依相同授權使用。本網站依其資料計算的版本分布圖、品牌占比圖、涵蓋率與 `api.json` 中的 `osShare` 資料屬於改作，依「相同方式分享」條款同樣以 CC BY-SA 3.0 提供。該資料以 StatCounter 追蹤網站的流量估算，不代表實際裝置總數，也不代表任何特定 App 的使用者組成。
- **Stack Overflow**：問題標題與連結來自 Stack Exchange API。使用者貢獻內容依 [CC BY-SA](https://stackoverflow.com/help/licensing) 授權，著作權屬於原作者；本網站在每則問題旁標示原作者（連到其個人頁）、原文連結與授權。
- **GitHub**：SDK 與 Cordova 的 issue 標題來自各開源專案的公開 issue，著作權屬於原作者與各專案；本網站在每則 issue 旁標示作者（GitHub 帳號）並連回原文。GitHub Actions runner 映像資訊來自 actions/runner-images 專案（MIT）。
- **App Store / Google Play**：銀行 App 的最低支援版本取自台灣區商店頁面公開顯示的資訊，可能因裝置、地區或 App 更新而不同，**不代表銀行的官方支援政策**，僅供業界參考。本網站僅呈現商店頁面公開的版本數字，**不對任何銀行或其 App 作評價、評比或推薦**；銀行名稱以部分遮罩顯示，以避免被誤解為與各銀行有關聯。
- **Apple 開發者系統狀態**：只呈現服務名稱、事件類型、狀態與時間，不轉載 Apple 的說明文字，並連回 Apple 的系統狀態頁。網站每天更新兩次，不是即時狀態。
- **React Native、Flutter**：版本與日期取自 GitHub releases 與 Flutter 官方版本清單；React Native 的 release notes 只計算各段落的項目數，不轉載內容，詳細內容請見原始連結。
- **xcodereleases.com、endoflife.date**：endoflife.date 依 MIT 授權；xcodereleases.com 未標示使用條款，只取版本與日期等事實資訊。
- **API、RSS 與行事曆**：每個 API 回應都附 `license`、`termsUrl` 與 `attribution` 欄位（各來源的授權、條款與須標示的來源或作者）；RSS 與行事曆也附上本聲明的連結。轉用時請保留這些標示。
- **Apple Developer Forums**：本網站只提供連結，不擷取其內容。

## 4. 本專案收錄的第三方素材

- **測試資料（`test/fixtures/`）**：解析程式的測試資料是本專案**自行編寫的模擬資料**，只重現解析所需的網頁結構（例如表格欄位、標記與 JSON 欄位），並保留版本號、日期、API 等級等事實資訊；不含第三方網頁的文章、說明文字、圖片或版面。其中 `all-versions.json` 是本網站自身輸出（與公開的 `api.json` 相同格式）的快照，銀行名稱已遮罩。
- **Apple Root CA 憑證（`src/fetchers/apple-root-ca.ts`）**：為 Apple 公開發布的根憑證，取自 <https://www.apple.com/certificateauthority/>，僅用於驗證與 gdmf.apple.com 的 TLS 連線。
- **圖示與分享預覽圖**：本專案自行製作。

## 5. 本專案的著作權與 AI 輔助開發聲明

### 5.1 AI 輔助開發

本專案的程式碼、測試、文件與頁面設計，**有相當比例是使用生成式 AI 工具（Anthropic 的 Claude Code）協助產生**。開發方式是：由作者提出需求與規格、決定功能範圍與取捨，AI 工具依指示產生或修改內容，再由作者決定是否採用、要求修正並發布；程式以自動化測試驗證。作者不保證已逐行審閱所有 AI 產生的內容。

特此說明以下幾點：

- **網站內容不是 AI 生成的。** 網站上的版本、期限、相容性、閃退與新聞等資料，都是程式在建置時從第 3 節所列的公開來源自動抓取並整理；新聞標題保留原文，沒有經過 AI 改寫或翻譯。網站執行時不呼叫任何 AI 服務。
- **AI 產生的內容可能有錯。** 程式邏輯、規則判斷（例如「開發者須知」與「待處理」的挑選）與文件說明，都可能因 AI 的錯誤而不正確，請一併參考第 6 節。
- **可能與既有程式碼相似。** 生成式 AI 的產出有可能與其訓練資料中的公開程式碼相似。作者沒有指示 AI 複製任何特定第三方的受保護程式碼；如果你認為本專案的某段內容侵害了你的權利，請依第 8 節聯絡，作者確認後會盡速移除或改寫。
- **工具服務條款。** 依 Anthropic 的服務條款，AI 產出內容的權利（如有）歸屬使用者。但這不代表該內容必然受著作權保護，見 5.2。

### 5.2 著作權歸屬

在法律允許的範圍內，本專案的程式碼、文字、頁面設計與圖示（不含第 2 至 4 節所述第三方內容與商標），其著作權屬於本專案作者。

依台灣、美國等多數法域目前的見解，**著作權保護的是人類的創作**；完全由 AI 自動產生、缺乏人類創作貢獻的部分，可能不受著作權保護。因此作者主張的權利，以作者本人的創作貢獻為限，包括需求與功能設計、內容的選擇與編排、對 AI 產出的修改，以及整體專案的組合與整合；對於依法不受保護的部分，作者不主張專屬權利。

### 5.3 授權

本專案**保留所有權利**（見 [LICENSE](LICENSE)），未採用開放原始碼授權。除法律允許的合理使用外，請勿未經同意重製、改作或散布本專案的原始碼、文字、頁面設計與圖示；GitHub 服務條款允許的瀏覽與 fork 不在此限。資料與引用內容的授權見 [DATA_LICENSE.md](DATA_LICENSE.md)。

本專案使用的開源套件依各自的授權條款使用，其著作權屬於原作者；清單與授權見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。這些套件透過 npm 安裝，並未收錄在本專案的原始碼中。

## 6. 資訊正確性與免責

- 本網站資料由程式**自動抓取與解析**（網站每天更新兩次），可能因來源網站改版、網路錯誤、快取或解析限制而**延遲、不完整或錯誤**。每個區塊都標示資料來源與抓取時間。
- 標示「**推估**」的項目依往年慣例推算（例如下一波 SDK 或 targetSdk 要求），並非官方公告；標示「**社群回報**」的閃退資訊來自 GitHub 與 Stack Overflow，未經官方確認。
- 「開發者須知」「待處理」與 Deployment Target / minSdk 建議，是依上述資料以固定規則推導的參考結果，**不保證適用於你的專案**。
- 本網站內容**僅供參考，不構成法律、法規遵循、資訊安全、財務或任何專業建議**。上架、版本支援、金融業法規遵循等決策，請以 Apple、Google 與主管機關的官方文件與公告為準，並自行評估或諮詢專業人士。
- 本網站以「現狀」及「現有」提供，不保證持續可用、不中斷、無錯誤或無安全漏洞。在法律允許的最大範圍內，本專案作者對因使用或無法使用本網站、或依賴本網站資訊所生的任何直接、間接、附帶、特殊或衍生損害（包括上架被拒、營運中斷或資料遺失），概不負責；但依適用法律不得預先排除或限制的責任（例如因故意或重大過失所生的責任），不在此限。
- 本網站連結的第三方網站由各自的經營者負責，其內容、可用性與隱私做法不在本網站控制範圍內。

## 7. 隱私

**本網站（GitHub Pages 上的靜態網站）：**

- **不使用 Cookie、不載入任何第三方程式、字型、廣告或分析追蹤工具，也不蒐集網站訪客的個人資料。**
- 你的瀏覽器只會向本網站本身請求頁面與資料檔（例如 `notifications.json`）；點擊外部連結時才會前往該網站。
- 下列資料**只儲存在你瀏覽器的 localStorage**，不會傳送到任何伺服器，可隨時透過清除網站資料刪除：
  - `theme`：你選擇的淺色或深色模式（沒有選擇時跟隨系統設定）
  - `seen-items`：上次造訪看過的項目（用於「新」標示）
  - `notif-known`、`notif-read`：通知中心已知與已讀的項目
- Service Worker 會在瀏覽器的快取（Cache Storage）保存頁面、資料與圖示，用於離線瀏覽。
- 系統通知需由你主動授權，可隨時在瀏覽器設定中關閉。
- 網站託管於 GitHub Pages，GitHub 可能依其[隱私權聲明](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement)記錄存取日誌（例如 IP 位址）。
- 行事曆訂閱（`calendar.ics`）與 RSS（`feed.xml`）由你的行事曆或閱讀器向 GitHub Pages 讀取。

**公開來源中的作者名稱：** 本網站會處理公開社群內容中的作者名稱，這是唯一涉及他人個人資料的部分：

- **內容**：Stack Overflow 問題作者的顯示名稱與個人頁連結、GitHub issue 作者的帳號名稱與個人頁連結，均取自 Stack Exchange API 與 GitHub API 的公開資料。
- **目的**：Stack Overflow 內容依 CC BY-SA 授權，必須標示原作者；GitHub issue 標題同樣是作者的著作，一併標示。除此之外不作其他用途，也不與其他資料比對或建立個人檔案。
- **期間**：只在該則內容仍在清單時間範圍內時顯示（GitHub SDK 回報近 30 天、Cordova 回報近 180 天、Stack Overflow 近 90 天），之後下一次更新就會自動移除；跨次保存的狀態檔（`state/`）不包含作者名稱。
- **地區**：網站與 API 託管於 GitHub Pages，可在全球存取。
- **你的權利**：如果你是這些作者之一，希望查詢、更正或停止顯示，請依第 8 節的私密管道提出；確認身分後，會在下一次網站更新時處理（網站每天更新兩次）。

**公開發布的檔案：** 除頁面與 `legal/` 底下的法律文件外，`api.json`、`api/` 底下各主題的 JSON、`notifications.json`、`calendar.ics`、`feed.xml`、`health.json`，以及用於跨次更新的 `state/changes.json`、`state/alerts.json`、`state/history.json` 皆為公開檔案，內容是彙整的公開資訊、項目首次出現時間、資料來源的健康狀態，以及銀行 App 最低版本（名稱已遮罩）、核心版本與各來源筆數的歷史紀錄，**不含金鑰**；除上述公開來源的作者名稱外，不含個人資料。

**自行部署本專案時：** 以 Docker 等方式自行架設時，伺服器會在有人瀏覽時向上述來源抓取資料（快取 10 分鐘），擷取頻率、是否符合各來源的使用條款，以及部署後的一切責任，均由部署者自行負責。若設定 `NOTIFY_WEBHOOK_URL` 或 `ALERT_WEBHOOK_URL`，系統會把新項目的標題與連結、或資料來源的故障訊息傳送到你指定的 webhook；若設定 `GITHUB_TOKEN`，僅用於查詢 GitHub 的公開資料（issue、release、資安公告）；同時設定 `ALERT_GITHUB_ISSUES=1` 時，也會用它在本專案的 repo 開立與關閉警報 issue。這些設定與傳送內容由部署者自行負責，請勿把金鑰寫入程式碼或提交到版本庫。

## 8. 聯絡與移除

**權利主張、個人資料請求、資安漏洞，以及來源經營者的反對**：這些內容可能包含姓名、聯絡方式或證據，請**不要**開公開 issue，改用 GitHub 的私密回報（只有你與維護者看得到）：
<https://github.com/louisxie0830/os-version-tracker/security/advisories/new>

需要提供的資料與處理方式見 [SECURITY.md](SECURITY.md)。這個功能是 GitHub 為資安漏洞設計的：送出者會成為該私密報告的協作者，帳號可能被列為回報者（可要求不署名）。目前沒有另外的專用信箱或表單，設立後會更新本聲明。目標是在 7 天內確認收到；確認內容屬實後，相關內容會在下一次網站更新時移除或調整。

**一般問題與錯誤回報**：請在 GitHub 開立公開 issue：<https://github.com/louisxie0830/os-version-tracker/issues>

本聲明可能隨時更新，更新後於本網站與本專案公布即生效。

本聲明的解釋與適用，以中華民國（台灣）法律為準據法。本聲明任何條款如經認定無效或無法執行，不影響其他條款的效力。

本聲明另有[英文版](DISCLAIMER.en.md)；中英文版本如有不一致，以中文版為準。
