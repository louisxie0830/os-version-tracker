# 資料來源合規清冊

<!-- 由 src/source-registry.ts 產生：npm run sources:doc。請改那個檔案，不要直接編輯本檔。 -->

最後檢查：2026-10-17 · 共 26 個來源（風險低 8、中 7、高 11）

共同做法：每天兩次（另加程式更新或手動重建時），以可識別的 User-Agent（`os-version-tracker`）請求；不登入、不繞過任何存取限制；每個請求有逾時限制。截至最後檢查日，除標示為「robots.txt 例外」的 dl.google.com 端點外，已檢查的列示端點都未被各網站的 robots.txt 禁止（gs.statcounter.com 與 gdmf.apple.com 沒有 robots.txt）；robots.txt 隨時可能改變，也不等於法律上的授權。每週會自動重新檢查（`npm run check:robots`），結果與 robots.txt 快照保存在該次執行的紀錄中。

風險等級：

- **低**：官方 feed、API、開放資料下載，或採開放授權的內容。
- **中**：公開網頁，robots.txt 未禁止，但條款沒有明確允許或禁止自動讀取。
- **高**：經營者的網站條款限制以自動方式取得「非刻意提供」的內容（Apple），或 robots.txt 禁止但仍讀取的例外（dl.google.com）。目前保留，因為只擷取版本、日期等事實資訊並附原始連結；經營者反對時會停止擷取（見 DISCLAIMER.md 第 3 節）。

| 來源 | 名稱 | 風險 | 方式 | 授權或條款 |
| --- | --- | --- | --- | --- |
| `ios` | Apple 軟體更新目錄 / Developer Releases | 高 | RSS / Atom、API、JSON 檔 | Apple RSS（官方提供）；endoflife.date（MIT）；gdmf.apple.com 為未公開文件的軟體更新目錄 |
| `android` | endoflife.date · Android Developers Blog | 低 | API、RSS / Atom | endoflife.date（MIT）；Android Developers Blog feed（官方提供） |
| `appleDeadline` | Apple Developer News | 低 | RSS / Atom | Apple Developer News RSS（官方提供） |
| `googleDeadline` | Google Play 目標 API 等級規定 | 中 | HTML 網頁 | Android 文件依 Apache 2.0、其他內容依 CC BY 2.5（Android 網站法律聲明）；Google 服務條款 |
| `iosToolchain` | xcodereleases.com · endoflife.date | 中 | JSON 檔、API | xcodereleases.com 未標示使用條款；endoflife.date（MIT） |
| `androidToolchain` | Google Maven · Gradle · Android SDK repository | 高 | XML 檔、API、HTML 網頁、JSON 檔 | Google Maven 與 Android SDK repository（Google 服務條款）；Maven Central（使用條款）；Gradle（網站條款）；JetBrains 版本清單（JetBrains 網站條款）；Kotlin 文件（Apache 2.0）；Android 文件（Apache 2.0） |
| `adoption` | Apple App Store 使用率 | 高 | HTML 網頁 | Apple 網站使用條款 |
| `appleNews` | Apple Developer News | 低 | RSS / Atom | Apple Developer News RSS（官方提供） |
| `androidNews` | Android Developers Blog | 低 | RSS / Atom | Android Developers Blog feed（官方提供） |
| `androidCompat` | AGP 相容性 · Kotlin Gradle plugin 相容性 | 中 | HTML 網頁 | Android 文件依 Apache 2.0、其他內容依 CC BY 2.5（Android 網站法律聲明）；Google 服務條款；Kotlin 文件依 Apache 2.0 |
| `xcodeSupport` | Apple Xcode 支援表 | 高 | HTML 網頁 | Apple 網站使用條款 |
| `appleRequirements` | Apple Upcoming Requirements | 高 | HTML 網頁 | Apple 網站使用條款 |
| `playPolicy` | Google Play 政策期限 | 中 | HTML 網頁 | Google 服務條款 |
| `playBilling` | Play Billing Library 淘汰時程 | 高 | HTML 網頁、XML 檔 | Android 文件依 Apache 2.0、其他內容依 CC BY 2.5（Android 網站法律聲明）；Google 服務條款 |
| `pageSize` | Android 16 KB 分頁大小指南 | 中 | HTML 網頁 | Android 文件依 Apache 2.0、其他內容依 CC BY 2.5（Android 網站法律聲明）；Google 服務條款 |
| `ciImages` | GitHub Actions runner images · Xcode Cloud | 高 | Markdown 檔、HTML 網頁 | actions/runner-images（MIT）；Xcode Cloud release notes 依 Apple 網站使用條款 |
| `agpJdk` | AGP 各版本 release notes | 中 | HTML 網頁 | Android 文件依 Apache 2.0、其他內容依 CC BY 2.5（Android 網站法律聲明）；Google 服務條款 |
| `privacy` | Apple 隱私清單與第三方 SDK 規定 | 高 | JSON 檔、HTML 網頁 | Apple 網站使用條款；文件頁面背後的 JSON 不是公開提供的資料介面 |
| `osShare` | StatCounter Global Stats（台灣、全球） | 低 | CSV 匯出 | CC BY-SA 3.0 |
| `twBanks` | App Store / Google Play（台灣區） | 中 | API、網頁內嵌資料 | iTunes Lookup API（Apple 公開提供的 API）；Google Play 商店頁依 Google Play 服務條款 |
| `devNews` | Apple / Android / Swift / Kotlin / Firebase / Cordova 官方 feed | 低 | RSS / Atom | 各官方 feed（供訂閱讀取）；Apple、Google、Swift.org、JetBrains、Apache Cordova、Firebase 各自的網站條款 |
| `cordova` | npm registry · Apache Cordova RELEASENOTES.md | 低 | API、Markdown 檔 | npm registry 公開 API；Apache Cordova 原始碼與 release notes 依 Apache 2.0；GitHub 服務條款 |
| `security` | Apple 安全性更新 · Android 安全性公告 · CISA KEV · GitHub Advisory Database | 高 | JSON 檔、API、HTML 網頁 | CISA KEV（CC0 1.0）；GitHub Advisory Database（CC BY 4.0）；Android 安全性公告（Android 開放原始碼專案授權）；Apple 安全性更新頁（Apple 網站使用條款） |
| `crashes` | Apple / Android release notes · GitHub SDK 與 Cordova issues | 高 | API、JSON 檔、HTML 網頁 | GitHub 服務條款；Stack Overflow 使用者內容依 CC BY-SA（Stack Exchange API 條款要求標示來源與作者）；Apple release notes 依 Apple 網站使用條款 |
| `appleStatus` | Apple Developer System Status | 高 | JSON 檔 | Apple 網站使用條款；狀態頁背後的資料檔不是公開提供的資料介面 |
| `frameworks` | GitHub facebook/react-native releases · Flutter release index | 低 | API、JSON 檔 | GitHub 服務條款；Flutter 官方版本清單（Flutter 工具本身讀取的公開資料） |

## 各來源細節

### `ios`：Apple 軟體更新目錄 / Developer Releases

- 風險：高
- 授權或條款：Apple RSS（官方提供）；endoflife.date（MIT）；gdmf.apple.com 為未公開文件的軟體更新目錄
- 端點：
  - RSS / Atom `https://developer.apple.com/news/releases/rss/releases.rss`（條款：<https://www.apple.com/legal/internet-services/terms/site.html>）
  - API `https://endoflife.date/api/ios.json`（條款：<https://github.com/endoflife-date/endoflife.date/blob/master/LICENSE>）
  - JSON 檔 `https://gdmf.apple.com/v2/pmv`（條款：<https://www.apple.com/legal/internet-services/terms/site.html>）
- 說明：RSS 與 endoflife.date 風險低；gdmf.apple.com 不是 Apple 公開提供的資料介面。只取版本、日期與規定名稱等事實資訊並附原始連結

### `android`：endoflife.date · Android Developers Blog

- 風險：低
- 授權或條款：endoflife.date（MIT）；Android Developers Blog feed（官方提供）
- 端點：
  - API `https://endoflife.date/api/android.json`（條款：<https://github.com/endoflife-date/endoflife.date/blob/master/LICENSE>）
  - RSS / Atom `https://developer.android.com/blog/atom.xml`（條款：<https://developer.android.com/legal>）
- 說明：只取版本號、API 等級、代號與發布日期

### `appleDeadline`：Apple Developer News

- 風險：低
- 授權或條款：Apple Developer News RSS（官方提供）
- 端點：
  - RSS / Atom `https://developer.apple.com/news/rss/news.rss`（條款：<https://www.apple.com/legal/internet-services/terms/site.html>）
- 說明：只取公告標題、日期與連結

### `googleDeadline`：Google Play 目標 API 等級規定

- 風險：中
- 授權或條款：Android 文件依 Apache 2.0、其他內容依 CC BY 2.5（Android 網站法律聲明）；Google 服務條款
- 端點：
  - HTML 網頁 `https://developer.android.com/google/play/requirements/target-sdk`（條款：<https://developer.android.com/legal>）
- 說明：只取期限日期與要求的 API 等級

### `iosToolchain`：xcodereleases.com · endoflife.date

- 風險：中
- 授權或條款：xcodereleases.com 未標示使用條款；endoflife.date（MIT）
- 端點：
  - JSON 檔 `https://xcodereleases.com/data.json`（條款：<https://xcodereleases.com>）
  - API `https://endoflife.date/api/iphone.json`（條款：<https://github.com/endoflife-date/endoflife.date/blob/master/LICENSE>）
- 說明：只取 Xcode 版本、build、需要的 macOS 與發布日期；xcodereleases.com 為社群專案，未找到使用條款（條款欄連到網站首頁）

### `androidToolchain`：Google Maven · Gradle · Android SDK repository

- 風險：高
- 授權或條款：Google Maven 與 Android SDK repository（Google 服務條款）；Maven Central（使用條款）；Gradle（網站條款）；JetBrains 版本清單（JetBrains 網站條款）；Kotlin 文件（Apache 2.0）；Android 文件（Apache 2.0）
- 端點：
  - XML 檔 `https://dl.google.com/dl/android/maven2/com/android/tools/build/gradle/maven-metadata.xml`（條款：<https://policies.google.com/terms>）
    - **robots.txt 例外**：dl.google.com 的 robots.txt 對所有程式 Disallow: /。這些是 Google Maven 與 Android SDK repository 的中繼資料檔，供 Gradle、Android Studio 等建置工具自動讀取；本站只讀取少數固定檔案取版本號，每天兩次
  - XML 檔 `https://dl.google.com/dl/android/maven2/androidx/compose/compose-bom/maven-metadata.xml`（條款：<https://policies.google.com/terms>）
    - **robots.txt 例外**：dl.google.com 的 robots.txt 對所有程式 Disallow: /。這些是 Google Maven 與 Android SDK repository 的中繼資料檔，供 Gradle、Android Studio 等建置工具自動讀取；本站只讀取少數固定檔案取版本號，每天兩次
  - XML 檔 `https://dl.google.com/android/repository/repository2-3.xml`（條款：<https://policies.google.com/terms>）
    - **robots.txt 例外**：dl.google.com 的 robots.txt 對所有程式 Disallow: /。這些是 Google Maven 與 Android SDK repository 的中繼資料檔，供 Gradle、Android Studio 等建置工具自動讀取；本站只讀取少數固定檔案取版本號，每天兩次
  - XML 檔 `https://repo1.maven.org/maven2/org/jetbrains/kotlin/kotlin-stdlib/maven-metadata.xml`（條款：<https://repo1.maven.org/terms.html>）
  - API `https://services.gradle.org/versions/current`（條款：<https://gradle.org/terms/>）
  - HTML 網頁 `https://gradle.org/releases/`（條款：<https://gradle.org/terms/>）
  - JSON 檔 `https://jb.gg/android-studio-releases-list.json`（條款：<https://www.jetbrains.com/legal/docs/company/useterms/>）
  - HTML 網頁 `https://kotlinlang.org/docs/releases.html`（條款：<https://github.com/JetBrains/kotlin-web-site/blob/master/LICENSE>）
  - HTML 網頁 `https://developer.android.com/studio/releases`（條款：<https://developer.android.com/legal>）
  - HTML 網頁 `https://developer.android.com/build/releases/gradle-plugin`（條款：<https://developer.android.com/legal>）
  - HTML 網頁 `https://developer.android.com/tools/releases/platforms`（條款：<https://developer.android.com/legal>）
  - HTML 網頁 `https://developer.android.com/tools/releases/build-tools`（條款：<https://developer.android.com/legal>）
  - HTML 網頁 `https://developer.android.com/develop/ui/compose/bom/bom-mapping`（條款：<https://developer.android.com/legal>）
- 說明：只取版本號與發布日期，主要來自供建置工具讀取的套件庫中繼資料。dl.google.com 的三個檔案為 robots.txt 例外（見端點說明）

### `adoption`：Apple App Store 使用率

- 風險：高
- 授權或條款：Apple 網站使用條款
- 端點：
  - HTML 網頁 `https://developer.apple.com/support/app-store/`（條款：<https://www.apple.com/legal/internet-services/terms/site.html>）
- 說明：只取各版本的採用率百分比與統計日期。只取版本、日期與規定名稱等事實資訊並附原始連結

### `appleNews`：Apple Developer News

- 風險：低
- 授權或條款：Apple Developer News RSS（官方提供）
- 端點：
  - RSS / Atom `https://developer.apple.com/news/rss/news.rss`（條款：<https://www.apple.com/legal/internet-services/terms/site.html>）
- 說明：只取標題、日期與連結，標題維持原文

### `androidNews`：Android Developers Blog

- 風險：低
- 授權或條款：Android Developers Blog feed（官方提供）
- 端點：
  - RSS / Atom `https://developer.android.com/blog/atom.xml`（條款：<https://developer.android.com/legal>）
- 說明：只取標題、日期與連結，標題維持原文

### `androidCompat`：AGP 相容性 · Kotlin Gradle plugin 相容性

- 風險：中
- 授權或條款：Android 文件依 Apache 2.0、其他內容依 CC BY 2.5（Android 網站法律聲明）；Google 服務條款；Kotlin 文件依 Apache 2.0
- 端點：
  - HTML 網頁 `https://developer.android.com/build/releases/gradle-plugin`（條款：<https://developer.android.com/legal>）
  - HTML 網頁 `https://developer.android.com/build/releases/about-agp`（條款：<https://developer.android.com/legal>）
  - HTML 網頁 `https://kotlinlang.org/docs/gradle-configure-project.html`（條款：<https://github.com/JetBrains/kotlin-web-site/blob/master/LICENSE>）
- 說明：只取相容性表格中的版本對應（AGP、Gradle、Kotlin、Android Studio）

### `xcodeSupport`：Apple Xcode 支援表

- 風險：高
- 授權或條款：Apple 網站使用條款
- 端點：
  - HTML 網頁 `https://developer.apple.com/support/xcode/`（條款：<https://www.apple.com/legal/internet-services/terms/site.html>）
- 說明：只取 Xcode、macOS 與 SDK 的版本對應。只取版本、日期與規定名稱等事實資訊並附原始連結

### `appleRequirements`：Apple Upcoming Requirements

- 風險：高
- 授權或條款：Apple 網站使用條款
- 端點：
  - HTML 網頁 `https://developer.apple.com/news/upcoming-requirements/`（條款：<https://www.apple.com/legal/internet-services/terms/site.html>）
- 說明：只取規定名稱與生效日期。只取版本、日期與規定名稱等事實資訊並附原始連結

### `playPolicy`：Google Play 政策期限

- 風險：中
- 授權或條款：Google 服務條款
- 端點：
  - HTML 網頁 `https://support.google.com/googleplay/android-developer/table/12921780`（條款：<https://policies.google.com/terms>）
- 說明：只取政策名稱與期限日期

### `playBilling`：Play Billing Library 淘汰時程

- 風險：高
- 授權或條款：Android 文件依 Apache 2.0、其他內容依 CC BY 2.5（Android 網站法律聲明）；Google 服務條款
- 端點：
  - HTML 網頁 `https://developer.android.com/google/play/billing/deprecation-faq`（條款：<https://developer.android.com/legal>）
  - XML 檔 `https://dl.google.com/dl/android/maven2/com/android/billingclient/billing/maven-metadata.xml`（條款：<https://policies.google.com/terms>）
    - **robots.txt 例外**：dl.google.com 的 robots.txt 對所有程式 Disallow: /。這些是 Google Maven 與 Android SDK repository 的中繼資料檔，供 Gradle、Android Studio 等建置工具自動讀取；本站只讀取少數固定檔案取版本號，每天兩次
- 說明：只取各版本的淘汰日期與最新版本號；dl.google.com 的版本檔為 robots.txt 例外（見端點說明）

### `pageSize`：Android 16 KB 分頁大小指南

- 風險：中
- 授權或條款：Android 文件依 Apache 2.0、其他內容依 CC BY 2.5（Android 網站法律聲明）；Google 服務條款
- 端點：
  - HTML 網頁 `https://developer.android.com/guide/practices/page-sizes`（條款：<https://developer.android.com/legal>）
- 說明：只取期限日期

### `ciImages`：GitHub Actions runner images · Xcode Cloud

- 風險：高
- 授權或條款：actions/runner-images（MIT）；Xcode Cloud release notes 依 Apple 網站使用條款
- 端點：
  - Markdown 檔 `https://raw.githubusercontent.com/actions/runner-images/main/README.md`（條款：<https://github.com/actions/runner-images/blob/main/LICENSE>）
  - HTML 網頁 `https://developer.apple.com/xcode-cloud/release-notes/`（條款：<https://www.apple.com/legal/internet-services/terms/site.html>）
- 說明：runner 映像資訊風險低；Xcode Cloud 只取提供的 Xcode 版本。只取版本、日期與規定名稱等事實資訊並附原始連結

### `agpJdk`：AGP 各版本 release notes

- 風險：中
- 授權或條款：Android 文件依 Apache 2.0、其他內容依 CC BY 2.5（Android 網站法律聲明）；Google 服務條款
- 端點：
  - HTML 網頁 `https://developer.android.com/build/releases/gradle-plugin`（條款：<https://developer.android.com/legal>）
  - HTML 網頁 `https://developer.android.com/build/releases/past-releases`（條款：<https://developer.android.com/legal>）
- 說明：只取各 AGP 版本需要的 JDK 版本

### `privacy`：Apple 隱私清單與第三方 SDK 規定

- 風險：高
- 授權或條款：Apple 網站使用條款；文件頁面背後的 JSON 不是公開提供的資料介面
- 端點：
  - JSON 檔 `https://developer.apple.com/tutorials/data/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype.json`（條款：<https://www.apple.com/legal/internet-services/terms/site.html>）
  - HTML 網頁 `https://developer.apple.com/support/third-party-SDK-requirements/`（條款：<https://www.apple.com/legal/internet-services/terms/site.html>）
- 說明：只取 API 類別、原因代碼與 SDK 名稱（規格名稱等事實資訊）。只取版本、日期與規定名稱等事實資訊並附原始連結

### `osShare`：StatCounter Global Stats（台灣、全球）

- 風險：低
- 授權或條款：CC BY-SA 3.0
- 端點：
  - CSV 匯出 `https://gs.statcounter.com/chart.php?…&csv=1`（條款：<https://creativecommons.org/licenses/by-sa/3.0/>）
- 須標示：StatCounter Global Stats
- 說明：使用網站提供的 CSV 下載；衍生的分布、涵蓋率與趨勢資料同樣以 CC BY-SA 3.0 提供

### `twBanks`：App Store / Google Play（台灣區）

- 風險：中
- 授權或條款：iTunes Lookup API（Apple 公開提供的 API）；Google Play 商店頁依 Google Play 服務條款
- 端點：
  - API `https://itunes.apple.com/lookup`（條款：<https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/index.html>）
  - 網頁內嵌資料 `https://play.google.com/store/apps/details`（條款：<https://play.google.com/about/play-terms/>）
- 說明：只取最低支援版本、版本號、targetSdk 與更新日期；銀行與 App 名稱部分遮罩，不評比任何銀行

### `devNews`：Apple / Android / Swift / Kotlin / Firebase / Cordova 官方 feed

- 風險：低
- 授權或條款：各官方 feed（供訂閱讀取）；Apple、Google、Swift.org、JetBrains、Apache Cordova、Firebase 各自的網站條款
- 端點：
  - RSS / Atom `https://developer.apple.com/news/rss/news.rss`（條款：<https://www.apple.com/legal/internet-services/terms/site.html>）
  - RSS / Atom `https://developer.apple.com/news/releases/rss/releases.rss`（條款：<https://www.apple.com/legal/internet-services/terms/site.html>）
  - RSS / Atom `https://www.swift.org/atom.xml`（條款：<https://www.swift.org/legal/license.html>）
  - RSS / Atom `https://developer.android.com/blog/atom.xml`（條款：<https://developer.android.com/legal>）
  - RSS / Atom `https://androidstudio.googleblog.com/feeds/posts/default`（條款：<https://policies.google.com/terms>）
  - RSS / Atom `https://developer.android.com/feeds/androidx-release-notes.xml`（條款：<https://developer.android.com/legal>）
  - RSS / Atom `https://blog.jetbrains.com/kotlin/feed/`（條款：<https://www.jetbrains.com/legal/docs/company/useterms/>）
  - RSS / Atom `https://cordova.apache.org/feed.xml`（條款：<https://www.apache.org/licenses/LICENSE-2.0>）
  - RSS / Atom `https://firebase.blog/rss.xml`（條款：<https://firebase.google.com/terms>）
- 說明：只取標題、日期與連結，標題維持原文

### `cordova`：npm registry · Apache Cordova RELEASENOTES.md

- 風險：低
- 授權或條款：npm registry 公開 API；Apache Cordova 原始碼與 release notes 依 Apache 2.0；GitHub 服務條款
- 端點：
  - API `https://registry.npmjs.org/{package}/latest`（條款：<https://docs.npmjs.com/policies/terms>）
  - API `https://api.github.com/repos/apache/{repo}/releases`（條款：<https://docs.github.com/site-policy/github-terms/github-terms-of-service>）
  - Markdown 檔 `https://raw.githubusercontent.com/apache/{repo}/master/RELEASENOTES.md`（條款：<https://www.apache.org/licenses/LICENSE-2.0>）
- 說明：版本與平台需求為事實資訊；破壞性變更與修正項目摘錄自 Apache 2.0 授權的 release notes

### `security`：Apple 安全性更新 · Android 安全性公告 · CISA KEV · GitHub Advisory Database

- 風險：高
- 授權或條款：CISA KEV（CC0 1.0）；GitHub Advisory Database（CC BY 4.0）；Android 安全性公告（Android 開放原始碼專案授權）；Apple 安全性更新頁（Apple 網站使用條款）
- 端點：
  - JSON 檔 `https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json`（條款：<https://www.cisa.gov/sites/default/files/licenses/kev/license.txt>）
  - API `https://api.github.com/advisories`（條款：<https://github.com/github/advisory-database/blob/main/LICENSE.md>）
  - HTML 網頁 `https://source.android.com/docs/security/bulletin/asb-overview`（條款：<https://source.android.com/docs/setup/about/licenses>）
  - HTML 網頁 `https://support.apple.com/en-us/100100`（條款：<https://www.apple.com/legal/internet-services/terms/site.html>）
- 須標示：GitHub Advisory Database（CC BY 4.0）
- 說明：KEV 與 GitHub Advisory 風險低；Apple 安全性更新頁只取版本名稱、日期與 CVE 編號。只取版本、日期與規定名稱等事實資訊並附原始連結

### `crashes`：Apple / Android release notes · GitHub SDK 與 Cordova issues

- 風險：高
- 授權或條款：GitHub 服務條款；Stack Overflow 使用者內容依 CC BY-SA（Stack Exchange API 條款要求標示來源與作者）；Apple release notes 依 Apple 網站使用條款
- 端點：
  - API `https://api.github.com/search/issues`（條款：<https://docs.github.com/site-policy/github-terms/github-terms-of-service>）
  - API `https://api.stackexchange.com/2.3/search/advanced`（條款：<https://stackoverflow.com/legal/api-terms-of-use>）
  - JSON 檔 `https://developer.apple.com/tutorials/data/documentation/…-release-notes.json`（條款：<https://www.apple.com/legal/internet-services/terms/site.html>）
  - HTML 網頁 `https://developer.android.com/about/versions/{major}`（條款：<https://developer.android.com/legal>）
- 須標示：Stack Overflow（CC BY-SA，標示原作者）；GitHub issue（標示原作者）
- 說明：GitHub 與 Stack Overflow 只取標題、作者名稱與連結並標示作者；Apple release notes 只取已知問題的標題。只取版本、日期與規定名稱等事實資訊並附原始連結

### `appleStatus`：Apple Developer System Status

- 風險：高
- 授權或條款：Apple 網站使用條款；狀態頁背後的資料檔不是公開提供的資料介面
- 端點：
  - JSON 檔 `https://www.apple.com/support/systemstatus/data/developer/system_status_en_US.js`（條款：<https://www.apple.com/legal/internet-services/terms/site.html>）
- 說明：只取服務名稱、事件類型、狀態與時間，不轉載 Apple 的說明文字

### `frameworks`：GitHub facebook/react-native releases · Flutter release index

- 風險：低
- 授權或條款：GitHub 服務條款；Flutter 官方版本清單（Flutter 工具本身讀取的公開資料）
- 端點：
  - API `https://api.github.com/repos/facebook/react-native/releases`（條款：<https://docs.github.com/site-policy/github-terms/github-terms-of-service>）
  - JSON 檔 `https://storage.googleapis.com/flutter_infra_release/releases/releases_macos.json`（條款：<https://policies.google.com/terms>）
- 說明：只取版本號、日期與連結；React Native release notes 只計算段落項目數，不轉載內容
