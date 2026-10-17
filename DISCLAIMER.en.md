# Disclaimer and Intellectual Property Notice

Last updated: October 17, 2026 · [中文版](DISCLAIMER.md)

OS Version Tracker (the "Site" or the "Project") is a non-commercial reference tool for developers, maintained by an individual (the "author") in a personal capacity. The Site is available at <https://louisxie0830.github.io/os-version-tracker/> and its source code at <https://github.com/louisxie0830/os-version-tracker>. It automatically aggregates public information to help iOS and Android developers keep track of OS versions, developer tools, app store requirements and compatibility. Please read the following before using the Site, its API or the Project.

If the Chinese and English versions differ, the Chinese version prevails.

## 1. Unofficial site

The Site is an independent, unofficial project. It is **not affiliated with, sponsored, endorsed or approved by** any of the following: Apple Inc., Google LLC, JetBrains s.r.o., Gradle Inc., GitHub Inc., Stack Exchange Inc., StatCounter, Meta Platforms, Inc., Airbnb, Inc., Block, Inc., Functional Software, Inc. (Sentry), MongoDB, Inc., or any bank, SDK or service provider mentioned on the Site.

The Site does not represent the views of any company, financial institution or organization that the author works for or deals with, and it is not official information of any organization. All data on the Site comes only from the public information listed in section 3; it contains no internal, confidential or non-public information of any organization.

## 2. Trademarks

All names and logos mentioned on the Site and in the Project belong to their respective owners. They are used for identification and description only and do not imply endorsement. These include, without limitation:

- **Apple**: Apple, iOS, iPadOS, macOS, watchOS, tvOS, visionOS, Xcode, Xcode Cloud, Swift, SwiftUI, iPhone, iPad, App Store, App Store Connect and TestFlight are trademarks of Apple Inc.
- **Google**: Android, Google Play, Play Console, Android Studio, Jetpack Compose, Firebase and Flutter are trademarks of Google LLC.
- **Developer tools and platforms**: Kotlin is a trademark of JetBrains s.r.o.; Gradle is a trademark of Gradle Inc.; GitHub, GitHub Actions and GitHub Pages are trademarks of GitHub Inc.; Stack Overflow is a trademark of Stack Exchange Inc.; StatCounter is a trademark of StatCounter.
- **SDKs and open-source projects**: Facebook SDK and React Native (Meta Platforms, Inc.), Lottie (Airbnb, Inc.), OkHttp (Block, Inc.), Glide, Coil, Sentry, Realm (MongoDB, Inc.), Alamofire, SDWebImage, Kingfisher and similar names belong to their respective owners or projects.
- **Banks**: the names and logos of the banks and their apps covered in the Site's "Taiwan bank app support" section (shown partially masked on the page) are trademarks or property of the respective banks or their affiliates.
- Other products, services and companies mentioned (for example Slack, Discord, Docker and Render) are trademarks of their respective owners.

## 3. Data sources and copyright in quoted content

The data shown on the Site is collected automatically from the public sources below. **Copyright in quoted content belongs to the original rights holders**; refer to the original websites for complete content. Different kinds of content rest on different grounds, and the Site handles them separately rather than relying on fair use across the board:

- **Facts** (version numbers, dates, API levels, deadlines and the like): plain facts are not protected by copyright.
- **Openly licensed content**: used and credited under its license, for example StatCounter (CC BY-SA 3.0), Stack Overflow (CC BY-SA), the GitHub Advisory Database (CC BY 4.0), CISA KEV (CC0 1.0) and Apache Cordova release notes (Apache 2.0).
- **Other titles and short excerpts** (news and announcement titles, GitHub issue titles): quoted only as far as needed for description and comparison, with the source, the author where available and a link to the original (Articles 52 and 64 of the Copyright Act of Taiwan); full texts are never republished.

Each source's endpoints, collection method, terms, license and risk assessment are listed in the [source compliance register](SOURCES.md) (in Chinese); a license summary is in [DATA_LICENSE.md](DATA_LICENSE.md).

How the Site collects data: it reads only public pages, feeds and APIs that require no login, on a schedule of twice a day (with extra runs when the code is updated or a rebuild is triggered manually), with a User-Agent that identifies the Project. It does not bypass any login, paywall, technological protection measure or access restriction, and it does not republish the full content of original web pages. As of the date last checked, apart from the exception below, none of the listed paths was disallowed by the website's robots.txt; robots.txt can change at any time and is not a legal permission, so it is re-checked automatically every week, with the results and snapshots kept. **Exception**: the robots.txt of dl.google.com (Google Maven and the Android SDK repository) disallows all automated access, yet the Site still reads a few fixed version metadata files there (AGP, Compose BOM, Play Billing and Android SDK platform versions), because they are repository data meant to be read automatically by build tools such as Gradle and Android Studio; the register rates them high-risk with the reason, and reading stops if Google objects. **Some Apple sources** (upcoming requirements, the Xcode support table, App Store usage, security releases, privacy documentation, release notes, the developer system status and the software update catalog) are web pages or the data behind them, and Apple's website terms restrict automated access to content not purposely made available; the Site extracts only facts from them, links to the original, and rates them high-risk in the register. If the rights holder or operator of a source objects to the Site collecting or quoting its content, please contact us as described in section 8, and the author will stop collecting it and remove the content concerned.

| Category | Sources |
|---|---|
| Apple (official) | developer.apple.com (Developer News / Releases, Upcoming Requirements, Xcode support table, App Store usage, release notes, privacy manifest documentation, Xcode Cloud release notes), www.apple.com (developer system status), support.apple.com (security releases), gdmf.apple.com (software update catalog), itunes.apple.com (iTunes Lookup API), apps.apple.com (links only) |
| Google (official) | developer.android.com (including the Android Developers Blog and the AndroidX feed), source.android.com (Android security bulletins), support.google.com (Play policies), play.google.com (store listings), dl.google.com (Google Maven, Android SDK repository), storage.googleapis.com (Flutter's official release list), androidstudio.googleblog.com |
| Developer tools | services.gradle.org, gradle.org, kotlinlang.org, repo1.maven.org, jb.gg (Android Studio release list), registry.npmjs.org (npm) |
| Developer news | www.swift.org, blog.jetbrains.com (Kotlin Blog), firebase.blog, cordova.apache.org, and the Apple and Google feeds listed above; news titles are shown in their original wording and link to the original articles |
| Security | www.cisa.gov (CISA KEV), the GitHub Advisory Database (api.github.com) |
| Third-party aggregators | xcodereleases.com, endoflife.date |
| Version and brand market share | StatCounter Global Stats (gs.statcounter.com) |
| Community and open-source projects | GitHub (api.github.com, raw.githubusercontent.com, github.com), Stack Exchange API (api.stackexchange.com) |

Notes on specific sources:

- **StatCounter Global Stats**: version market share data is used under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) and attributed as "StatCounter Global Stats". Phone brand share comes from StatCounter too and is used under the same license. The version and brand charts, coverage figures and the `osShare` data in `api.json` that the Site computes from it are adaptations and, under the ShareAlike term, are likewise made available under CC BY-SA 3.0. It is estimated from traffic to websites that use StatCounter; it does not represent the total number of devices or the user base of any particular app.
- **Stack Overflow**: question titles and links come from the Stack Exchange API. User contributions are licensed under [CC BY-SA](https://stackoverflow.com/help/licensing) and remain the copyright of their authors; the Site shows each question with its author (linked to their profile), a link to the original question and the license.
- **GitHub**: SDK and Cordova issue titles come from public issues of the respective open-source projects and remain the copyright of their authors and projects; the Site shows each issue with its author (GitHub account) and a link to the original. GitHub Actions runner image information comes from the actions/runner-images project (MIT).
- **App Store / Google Play**: the minimum OS versions of bank apps are taken from information publicly displayed on the Taiwan store listings. They may vary by device, region or app update, **do not represent any bank's official support policy**, and are provided as an industry reference only. The Site only shows the version numbers publicly displayed on the store listings and **does not review, rate, rank or recommend any bank or its apps**; bank names are partially masked to avoid any impression of association with the banks.
- **Apple Developer System Status**: only the service name, the kind of event, its state and times are shown, not Apple's wording, with a link to Apple's status page. The Site refreshes twice a day, so this is not live status.
- **React Native and Flutter**: versions and dates come from GitHub releases and Flutter's official release list; React Native release notes are only counted by section, never republished — follow the links for the details.
- **xcodereleases.com and endoflife.date**: endoflife.date is MIT-licensed; xcodereleases.com states no terms of use, and only facts such as versions and dates are taken from it.
- **API, feed and calendar**: every API response carries `license`, `termsUrl` and `attribution` fields (each source's license, terms and required credit); the feed and the calendar link to this notice too. Please keep these when reusing the data.
- **Apple Developer Forums**: the Site only provides links and does not collect any forum content.

## 4. Third-party material included in the Project

- **Test fixtures (`test/fixtures/`)**: the parser test data is **synthetic data written for the Project**. It reproduces only the page structure the parsers need (such as table columns, markup and JSON fields) and keeps factual information such as version numbers, dates and API levels; it contains no articles, explanatory text, images or layout from third-party pages. `all-versions.json` is a snapshot of the Site's own output (the same format as the public `api.json`), with bank names masked.
- **Apple Root CA certificate (`src/fetchers/apple-root-ca.ts`)**: a root certificate publicly distributed by Apple at <https://www.apple.com/certificateauthority/>, used only to verify TLS connections to gdmf.apple.com.
- **Icons and the social preview image**: created for the Project.

## 5. Copyright in the Project and AI-assisted development

### 5.1 AI-assisted development

**A substantial part of the Project's code, tests, documentation and page design was produced with the help of a generative AI tool (Anthropic's Claude Code).** The author sets the requirements and specifications and decides scope and trade-offs; the AI tool generates or modifies content as instructed; the author then decides whether to adopt it, requests corrections and publishes it, and the code is verified with automated tests. The author does not warrant having reviewed every line of AI-generated content.

Please note:

- **The Site's content is not AI-generated.** The versions, deadlines, compatibility, crash and news information shown on the Site are fetched automatically at build time from the public sources listed in section 3. News titles are shown in their original wording, not rewritten or translated by AI. The Site does not call any AI service at runtime.
- **AI-generated material may contain errors.** Program logic, rule-based judgements (such as the developer checklists and the "act now" selection) and documentation may be wrong because of AI mistakes. See also section 6.
- **Possible similarity to existing code.** Output from generative AI may resemble public code in its training data. The author has not instructed the AI to copy any specific third party's protected code. If you believe any part of the Project infringes your rights, please contact us as described in section 8; once confirmed, the material will be removed or rewritten promptly.
- **Tool terms of service.** Under Anthropic's terms of service, rights in AI outputs (if any) belong to the user. This does not mean such output is necessarily protected by copyright; see 5.2.

### 5.2 Copyright ownership

To the extent permitted by law, the code, text, page design and icons of the Project (excluding the third-party content and trademarks described in sections 2 to 4) are copyright © the author of the Project.

Under the prevailing view in Taiwan, the United States and many other jurisdictions, **copyright protects human authorship**; material generated entirely by AI without human creative contribution may not be protected. The author therefore claims rights only to the extent of the author's own creative contribution, including the requirements and feature design, the selection and arrangement of content, modifications to AI output, and the composition and integration of the Project as a whole. The author claims no exclusive rights in any part that is not protected by law.

### 5.3 License

**All rights are reserved** in the Project (see [LICENSE](LICENSE)); it is not under an open-source license. Except for uses permitted by law such as fair use, please do not reproduce, adapt or distribute the Project's source code, text, page design or icons without permission; viewing and forking as permitted by the GitHub Terms of Service are not affected. Licenses for data and quoted content are summarized in [DATA_LICENSE.md](DATA_LICENSE.md).

Open-source packages used by the Project are used under their own licenses and remain the copyright of their authors; they are listed with their licenses in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). They are installed through npm and are not included in the Project's source code.

## 6. Accuracy and limitation of liability

- Data on the Site is **collected and parsed automatically** (the Site is rebuilt twice a day) and may be **delayed, incomplete or incorrect** because of changes to source websites, network errors, caching or parsing limitations. Each section shows its data sources and fetch time.
- Items marked "**推估 (estimated)**" are projections based on past patterns (for example the next SDK or targetSdk requirement) and are not official announcements. Crash information marked "**社群回報 (community report)**" comes from GitHub and Stack Overflow and has not been confirmed by any vendor.
- The developer checklists, the "act now" cards and the Deployment Target / minSdk suggestions are reference results derived from the data above by fixed rules and are **not guaranteed to fit your project**.
- Content on the Site is **for reference only and does not constitute legal, regulatory compliance, information security, financial or any other professional advice**. For decisions about app store submission, version support or financial-industry compliance, rely on official documentation and announcements from Apple, Google and the competent authorities, and make your own assessment or consult a professional.
- The Site is provided "as is" and "as available", without any warranty that it will be available, uninterrupted, error-free or free of security vulnerabilities. To the maximum extent permitted by law, the author of the Project is not liable for any direct, indirect, incidental, special or consequential damages (including app rejection, business interruption or data loss) arising from the use of, or inability to use, the Site, or from reliance on its information, except for liability that cannot be excluded or limited in advance under applicable law (such as liability for intentional misconduct or gross negligence).
- Third-party websites linked from the Site are the responsibility of their operators; their content, availability and privacy practices are outside the Site's control.

## 7. Privacy

**The Site (a static website hosted on GitHub Pages):**

- **It sets no cookies, loads no third-party scripts, fonts, ads or analytics, and collects no personal data about its visitors.**
- Your browser only requests pages and data files from the Site itself (for example `notifications.json`); you visit external websites only when you click their links.
- The following data is **stored only in your browser's localStorage**, is never sent to any server, and can be deleted at any time by clearing the site's data:
  - `theme`: the light or dark mode you picked (follows your system setting when you haven't)
  - `seen-items`: items seen on your previous visit (used for the "new" marker)
  - `notif-known`, `notif-read`: items known to and read in the notification center
- The service worker stores pages, data and icons in the browser's Cache Storage for offline use.
- System notifications are shown only if you grant permission, which you can revoke at any time in your browser settings.
- The Site is hosted on GitHub Pages; GitHub may keep access logs (such as IP addresses) as described in its [privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).
- Calendar subscriptions (`calendar.ics`) and the feed (`feed.xml`) are fetched from GitHub Pages by your calendar app or feed reader.

**Author names from public sources:** the Site processes the names of authors of public community content; this is the only personal data about others it handles:

- **What**: the display name and profile link of Stack Overflow question authors, and the account name and profile link of GitHub issue authors, taken from the public Stack Exchange API and GitHub API.
- **Why**: Stack Overflow content is licensed under CC BY-SA, which requires crediting the author; GitHub issue titles are their authors' writing too and are credited the same way. They are used for nothing else, and never matched with other data or profiled.
- **How long**: only while the item is within its list's time window (GitHub SDK reports: 30 days; Cordova reports: 180 days; Stack Overflow: 90 days); after that the next refresh removes it. The state files kept between runs (`state/`) contain no author names.
- **Where**: the Site and its API are hosted on GitHub Pages and accessible worldwide.
- **Your rights**: if you are one of these authors and want to know what is shown, have it corrected or have it stop being shown, use the private channel in section 8; once your identity is confirmed, it is handled in the next site refresh (the Site refreshes twice a day).

**Publicly published files:** besides the page and the legal documents under `legal/`, `api.json`, the topic JSON files under `api/`, `notifications.json`, `calendar.ics`, `feed.xml`, `health.json`, and the `state/changes.json`, `state/alerts.json` and `state/history.json` files used between rebuilds are public. They contain aggregated public information, the time each item was first seen, the health of each data source, and the history of bank apps' minimum versions (names masked), of the core versions and of each source's item counts, and **no secrets**; apart from the author names described above, they contain no personal data.

**If you deploy the Project yourself:** when you host it yourself (for example with Docker), the server fetches from the sources above when someone visits (cached for 10 minutes). The deployer alone is responsible for the request frequency, for complying with each source's terms of use, and for everything about their deployment. When `NOTIFY_WEBHOOK_URL` or `ALERT_WEBHOOK_URL` is set, the system sends the titles and links of new items, or data source failure messages, to the webhook you configured; `GITHUB_TOKEN`, if set, is used only to read public GitHub data (issues, releases, security advisories) and, together with `ALERT_GITHUB_ISSUES=1`, to open and close alert issues in the Project's own repository. The deployer is responsible for these settings and for what they send. Never write secrets into the code or commit them to the repository.

## 8. Contact and removal requests

**Rights claims, personal data requests, security vulnerabilities and objections from source operators**: these may include names, contact details or evidence, so please do **not** open a public issue; use GitHub's private reporting instead (visible only to you and the maintainer):
<https://github.com/louisxie0830/os-version-tracker/security/advisories/new>

What to include and how requests are handled is described in [SECURITY.md](SECURITY.md). GitHub designed this feature for security vulnerabilities: the submitter becomes a collaborator on the private report and their account may be listed as the reporter (you can ask not to be credited). There is no separate dedicated email address or form yet; this notice will be updated once there is one. We aim to acknowledge receipt within 7 days; once the request is confirmed, the content concerned is removed or adjusted in the next site refresh.

**General questions and bug reports**: please open a public issue on GitHub: <https://github.com/louisxie0830/os-version-tracker/issues>

This notice may be updated at any time; updates take effect once published on the Site and in the Project.

This notice is governed by and construed in accordance with the laws of the Republic of China (Taiwan). If any provision is held invalid or unenforceable, the remaining provisions remain in effect.
