import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

const item = (id: string) => ({ id, kind: 'deadline', platform: 'Android', title: `Item ${id}`, detail: '', url: `https://example.com/${id}`, date: '2027-01-27' });

/** Runs src/notify.ts as the workflow does, against a state file and (maybe) a local webhook (served by this
 * process, so the child runs asynchronously) */
function runNotify(env: Record<string, string>): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/notify.ts'], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', c => { stdout += c; });
    child.stderr.setEncoding('utf8').on('data', c => { stderr += c; });
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

test('notify sends the queued items once the site is up, and empties the queue it delivered', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'notify-'));
  const file = path.join(dir, 'changes.json');
  const posts: string[] = [];
  const server = createServer((req, res) => { let body = ''; req.on('data', c => { body += c; }); req.on('end', () => { posts.push(body); res.end('ok'); }); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  try {
    writeFileSync(file, JSON.stringify({ baselineAt: '2026-01-01T00:00:00Z', seen: { a: null, b: '2026-10-25T00:00:00Z' }, pending: [item('b')] }));
    const out = await runNotify({ CHANGES_STATE_FILE: file, NOTIFY_WEBHOOK_URL: `http://127.0.0.1:${port}/hook`, SITE_URL: 'https://site.example' });
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /Queued 1, still waiting 0/);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).pending?.length ?? 0, 0);
    const none = await runNotify({ CHANGES_STATE_FILE: file, NOTIFY_WEBHOOK_URL: `http://127.0.0.1:${port}/hook` });
    assert.match(none.stdout, /No queued notifications/);
    const off = await runNotify({ CHANGES_STATE_FILE: file, NOTIFY_WEBHOOK_URL: '' });
    assert.match(off.stdout, /nothing to send/);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(posts.length, 1);
  assert.match(JSON.parse(posts[0]).text, /Item b/);
});
