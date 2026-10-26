/**
 * Sends the change notifications a static build queued (src/build-static.ts holds them back), run by the
 * workflow's notify job after the site that shows them is deployed. Reads and updates .state/changes.json:
 * delivered items leave the queue, ones the webhook couldn't take this time stay for the next run.
 *
 * Usage: npx tsx src/notify.ts, or node dist/notify.js once built   (NOTIFY_WEBHOOK_URL and SITE_URL from the environment; without a webhook it
 * does nothing)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.CHANGES_STATE_FILE ??= path.join(ROOT, '.state', 'changes.json');

async function main(): Promise<void> {
  const siteUrl = (process.env.SITE_URL ?? '').replace(/\/$/, '');
  if (!process.env.NOTIFY_WEBHOOK_URL) {
    console.log('No NOTIFY_WEBHOOK_URL: nothing to send');
    return;
  }
  // Imported only now: changes.ts reads CHANGES_STATE_FILE when it loads
  const { flushNotifications, notifyWebhook, pendingCount } = await import('./changes.js');
  const queued = pendingCount();
  if (!queued) {
    console.log('No queued notifications');
    return;
  }
  await notifyWebhook([], siteUrl);
  await flushNotifications();
  console.log(`Queued ${queued}, still waiting ${pendingCount()}`);
}

main().then(() => process.exit(0), err => {
  console.error(err);
  process.exit(1);
});
