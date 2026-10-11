# Disclaimer and Intellectual Property Notice

Last updated: October 11, 2026 · [中文版](DISCLAIMER.md)

OS Version Tracker (the "Site" or the "Project") is a reference tool for developers, maintained by an individual. The Site is available at <https://louisxie0830.github.io/os-version-tracker/> and its source code at <https://github.com/louisxie0830/os-version-tracker>. It automatically aggregates public information to help iOS and Android developers keep track of OS versions, developer tools, app store requirements and compatibility. By using the Site or the Project, you acknowledge and agree to the following.

If the Chinese and English versions differ, the Chinese version prevails.

## 1. Unofficial site

The Site is an independent, unofficial project. It is **not affiliated with, sponsored, endorsed or approved by** any of the following: Apple Inc., Google LLC, JetBrains s.r.o., Gradle Inc., GitHub Inc., Stack Exchange Inc., StatCounter, Meta Platforms, Inc., Airbnb, Inc., Block, Inc., Functional Software, Inc. (Sentry), MongoDB, Inc., Digital.ai, or any bank, SDK or service provider mentioned on the Site.

## 2. Trademarks

All names and logos mentioned on the Site and in the Project belong to their respective owners. They are used for identification and description only and do not imply endorsement. These include, without limitation:

- **Apple**: Apple, iOS, iPadOS, macOS, watchOS, tvOS, visionOS, Xcode, Xcode Cloud, Swift, SwiftUI, iPhone, iPad, App Store, App Store Connect and TestFlight are trademarks of Apple Inc.
- **Google**: Android, Google Play, Play Console, Android Studio, Jetpack Compose, Firebase and Flutter are trademarks of Google LLC.
- **Developer tools and platforms**: Kotlin is a trademark of JetBrains s.r.o.; Gradle is a trademark of Gradle Inc.; GitHub, GitHub Actions and GitHub Pages are trademarks of GitHub Inc.; Stack Overflow is a trademark of Stack Exchange Inc.; StatCounter is a trademark of StatCounter.
- **SDKs and open-source projects**: Facebook SDK and React Native (Meta Platforms, Inc.), Lottie (Airbnb, Inc.), OkHttp (Block, Inc.), Glide, Coil, Sentry, Realm (MongoDB, Inc.), Alamofire, SDWebImage, Kingfisher and similar names belong to their respective owners or projects.
- **Banks**: the names and logos of the banks and mobile banking apps covered in the Site's "Taiwan bank app support" section (shown partially masked on the page) are trademarks or property of the respective banks or their affiliates.
- Other products, services and companies mentioned (for example Slack, Discord, Docker and Render) are trademarks of their respective owners.

## 3. Data sources and copyright in quoted content

The data shown on the Site is collected automatically from the public sources below. **Copyright in quoted content belongs to the original rights holders.** The Site quotes version numbers, dates, titles or short excerpts only to the extent reasonably necessary for description, comparison and research, and always links to and credits the original source. Refer to the original websites for complete content.

| Category | Sources |
|---|---|
| Apple (official) | developer.apple.com (Developer News / Releases, Upcoming Requirements, Xcode support table, App Store usage, release notes, privacy manifest documentation), gdmf.apple.com, www.apple.com, support.apple.com, itunes.apple.com, apps.apple.com |
| Google (official) | developer.android.com, android-developers.googleblog.com, support.google.com (Play policies), play.google.com, dl.google.com (Google Maven, Android SDK repository) |
| Developer tools | services.gradle.org, gradle.org, kotlinlang.org, repo1.maven.org, jb.gg (Android Studio release list) |
| Third-party aggregators | xcodereleases.com, endoflife.date |
| Version market share | StatCounter Global Stats (gs.statcounter.com) |
| Community | GitHub (api.github.com, raw.githubusercontent.com, github.com), Stack Exchange API (api.stackexchange.com) |

Notes on specific sources:

- **StatCounter Global Stats**: version market share data is used under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) and attributed as "StatCounter Global Stats". It is estimated from traffic to websites that use StatCounter; it does not represent the total number of devices or the user base of any particular app.
- **Stack Overflow**: question titles and links come from the Stack Exchange API. User contributions are licensed under [CC BY-SA](https://stackoverflow.com/help/licensing) and remain the copyright of their authors; the Site links to each original question as attribution.
- **GitHub**: SDK issue titles come from public issues of the respective open-source projects and remain the copyright of their authors and projects. GitHub Actions runner image information comes from the actions/runner-images project.
- **App Store / Google Play**: the minimum OS versions of bank apps are taken from information publicly displayed on the Taiwan store listings. They may vary by device, region or app update, **do not represent any bank's official support policy**, and are provided as an industry reference only.
- **xcodereleases.com and endoflife.date**: quoted in accordance with their respective terms of use.
- **Apple Developer Forums**: the Site only provides links and does not collect any forum content.

## 4. Third-party material included in the Project

- **Test fixtures (`test/fixtures/`)**: to test the parsers automatically, the Project includes **trimmed copies** of some of the public web pages, RSS feeds and JSON listed above (navigation, styles and scripts removed; only the parts the parsers need are kept). They are used solely for non-commercial testing and remain the copyright of their owners. If a rights holder objects to their inclusion, please contact us as described in section 8 and we will remove them and switch to synthetic test data.
- **Apple Root CA certificate (`src/fetchers/apple-root-ca.ts`)**: a root certificate publicly distributed by Apple at <https://www.apple.com/certificateauthority/>, used only to verify TLS connections to gdmf.apple.com.
- **Icons and the social preview image**: created for the Project.

## 5. Copyright in the Project

The code, text, page design and icons written for the Project (excluding the third-party content and trademarks described in sections 2 to 4) are copyright © Louis Xie.

The Project **does not currently include an open-source license (LICENSE)**. Under copyright law, except for uses permitted by law such as fair use, the source code may not be reproduced, adapted or distributed without permission; viewing and forking as permitted by the GitHub Terms of Service are not affected. If a license is added later, its terms will apply.

## 6. Accuracy and limitation of liability

- Data on the Site is **collected and parsed automatically** (the Site is rebuilt every 30 minutes) and may be **delayed, incomplete or incorrect** because of changes to source websites, network errors, caching or parsing limitations. Each section shows its data sources and fetch time.
- Items marked "**推估 (estimated)**" are projections based on past patterns (for example the next SDK or targetSdk requirement) and are not official announcements. Crash information marked "**社群回報 (community report)**" comes from GitHub and Stack Overflow and has not been confirmed by any vendor.
- The developer checklists, the project checker and the Deployment Target / minSdk suggestions are reference results derived from the data above by fixed rules and are **not guaranteed to fit your project**.
- Content on the Site is **for reference only and does not constitute legal, regulatory compliance, information security, financial or any other professional advice**. For decisions about app store submission, version support or financial-industry compliance, rely on official documentation and announcements from Apple, Google and the competent authorities, and make your own assessment or consult a professional.
- The Site is provided "as is" and "as available", without any warranty that it will be available, uninterrupted, error-free or free of security vulnerabilities. To the maximum extent permitted by law, the author of the Project is not liable for any direct, indirect, incidental, special or consequential damages (including app rejection, business interruption or data loss) arising from the use of, or inability to use, the Site, or from reliance on its information.
- Third-party websites linked from the Site are the responsibility of their operators; their content, availability and privacy practices are outside the Site's control.

## 7. Privacy

**The Site (a static website hosted on GitHub Pages):**

- **It sets no cookies, loads no third-party scripts, fonts, ads or analytics, and collects no personal data.**
- Your browser only requests pages and data files from the Site itself (for example `notifications.json`); you visit external websites only when you click their links.
- The following data is **stored only in your browser's localStorage**, is never sent to any server, and can be deleted at any time by clearing the site's data:
  - `project-config`: versions entered in the project checker
  - `seen-items`: items seen on your previous visit (used for the "new" marker)
  - `notif-known`, `notif-read`: items known to and read in the notification center
- The service worker stores pages, data and icons in the browser's Cache Storage for offline use.
- System notifications are shown only if you grant permission, which you can revoke at any time in your browser settings.
- The Site is hosted on GitHub Pages; GitHub may keep access logs (such as IP addresses) as described in its [privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).
- Calendar subscriptions (`calendar.ics`) and the feed (`feed.xml`) are fetched from GitHub Pages by your calendar app or feed reader.

**Publicly published files:** besides the page itself, `api.json`, `notifications.json`, `calendar.ics`, `feed.xml`, `health.json`, `sitemap.xml`, and the `state/changes.json` and `state/alerts.json` files used between rebuilds are public. They contain aggregated public information, the time each item was first seen and the health of each data source, and **no personal data or secrets**.

**If you deploy the Project yourself:** when `NOTIFY_WEBHOOK_URL` or `ALERT_WEBHOOK_URL` is set, the system sends the titles and links of new items, or data source failure messages, to the webhook you configured; `GITHUB_TOKEN`, if set, is used only to search public GitHub issues. The deployer is responsible for these settings and for what they send. Never write secrets into the code or commit them to the repository.

## 8. Contact and removal requests

To report an error, assert a right or request removal of content, please open an issue on GitHub:
<https://github.com/louisxie0830/os-version-tracker/issues>

We will remove or adjust the content concerned promptly after receiving a reasonable notice.

This notice may be updated at any time; updates take effect once published on the Site and in the Project.
