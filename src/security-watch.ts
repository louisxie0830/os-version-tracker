/**
 * The hourly security check (.github/workflows/security-watch.yml): fetches only the security sources, works
 * out what needs action now (security-urgent.ts) and opens a GitHub issue for each new item
 * (security-alerts.ts). It changes nothing on the site and saves no state; the site shows the same items at its
 * next refresh.
 *
 * Usage: npx tsx src/security-watch.ts   (GITHUB_TOKEN, GITHUB_REPOSITORY and ALERT_GITHUB_ISSUES=1 to open
 * issues; without them it only prints what it would send. SITE_URL for the link in each issue)
 */
import { githubIssuesConfig } from './alerts.js';
import { fetchDevNews, NEWS_SOURCES } from './fetchers/dev-news.js';
import { fetchSecurityReport } from './fetchers/security.js';
import { sendSecurityIssues, toSend } from './security-alerts.js';
import { TW_AUTHORITY, urgentSecurityItems } from './security-urgent.js';

async function main(): Promise<void> {
  const now = new Date();
  const security = await fetchSecurityReport();
  // The Taiwan authorities' notices; nothing remembered or forgotten (that is the site build's state)
  const devNews = await fetchDevNews(NEWS_SOURCES.filter(s => TW_AUTHORITY.includes(s.id)), undefined, (_id, items) => items, now, () => {})
    .catch(err => {
      console.warn(`[security-watch] Taiwan notices unavailable (${(err as Error).message})`);
      return [];
    });
  const items = urgentSecurityItems({ security, devNews }, now);
  console.log(`${items.length} item(s) need action now`);
  for (const i of items) console.log(`- ${i.date} [${i.source}] ${i.title}`);

  const config = githubIssuesConfig();
  if (!config) {
    console.log(`No GitHub issue settings: would send ${toSend(items, new Set(), now).length} (not checking what was already sent)`);
    return;
  }
  const sent = await sendSecurityIssues(items, config, (process.env.SITE_URL ?? '').replace(/\/$/, ''), now);
  console.log(`Opened ${sent.length} issue(s)${sent.length ? `: ${sent.join(', ')}` : ''}`);
}

main().then(() => process.exit(0), err => {
  console.error(err);
  process.exit(1);
});
