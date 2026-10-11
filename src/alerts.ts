/**
 * Source health alerting. Every refresh reports each scraped source's outcome; failures are logged,
 * and when ALERT_WEBHOOK_URL is set a Slack-compatible `{ "text": ... }` message is POSTed only on
 * transitions: the first failure of a streak, and a recovery once the source works again.
 */

interface SourceState {
  ok: boolean;
  /** When the current ok/failing streak started */
  since: string;
  /** Consecutive failures in the current streak */
  failures: number;
  /** Last state the webhook was successfully told about; undefined until the first report */
  notifiedOk?: boolean;
}

const states = new Map<string, SourceState>();

const WEBHOOK_TIMEOUT_MS = 5_000;

/** For tests: forget all remembered source states */
export function resetAlertState(): void {
  states.clear();
}

async function postWebhook(url: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[alerts] webhook responded ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[alerts] webhook failed (${(err as Error)?.message ?? err})`);
    return false;
  }
}

/**
 * Records a source's outcome. Never throws. Resolves once any webhook call has finished,
 * so callers can fire-and-forget it.
 */
export async function reportSourceStatus(key: string, ok: boolean, detail?: string): Promise<void> {
  try {
    const now = new Date().toISOString();
    const prev = states.get(key);
    const state: SourceState = prev && prev.ok === ok
      ? { ...prev, failures: ok ? 0 : prev.failures + 1 }
      : { ok, since: now, failures: ok ? 0 : 1, notifiedOk: prev?.notifiedOk };
    states.set(key, state);

    if (!ok) {
      console.error(`[${key}] failed (${detail ?? 'unknown error'})${state.failures > 1 ? ` – ${state.failures} in a row` : ''}`);
    } else if (prev && !prev.ok) {
      console.info(`[${key}] recovered after ${prev.failures} failure(s)`);
    }

    // A healthy first report is the baseline, not news
    if (ok && state.notifiedOk === undefined) {
      state.notifiedOk = true;
      return;
    }
    // Already told the webhook about this state (or nothing changed)
    if (state.notifiedOk === ok) return;

    const webhook = process.env.ALERT_WEBHOOK_URL;
    if (!webhook) {
      state.notifiedOk = ok;
      return;
    }

    const text = ok
      ? `[os-version-tracker] RECOVERED: source "${key}" is working again (was failing since ${prev?.since ?? 'unknown'}).`
      : `[os-version-tracker] FAILING: source "${key}" could not be fetched or parsed – ${detail ?? 'unknown error'}. ` +
        'The page layout may have changed; the section is hidden until it recovers.';

    // Mark first so overlapping reports don't double-send; roll back so a failed send is retried next refresh
    state.notifiedOk = ok;
    if (!(await postWebhook(webhook, text)) && states.get(key) === state) {
      state.notifiedOk = !ok;
    }
  } catch (err) {
    console.error(`[alerts] unexpected error (${(err as Error)?.message ?? err})`);
  }
}
