import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchWithTimeout } from '../src/net.ts';

async function withServer(handler: http.RequestListener, run: (base: string) => Promise<void>) {
  const server = http.createServer(handler);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
}

test('fetchWithTimeout aborts a hung upstream and names it (without the query string)', async () => {
  await withServer(() => { /* never responds */ }, async base => {
    const started = Date.now();
    await assert.rejects(fetchWithTimeout(`${base}/slow?token=secret`, {}, 150), (err: Error) => {
      assert.match(err.message, /^Timed out after 0\.15s: 127\.0\.0\.1:\d+\/slow$/);
      assert.ok(!err.message.includes('secret'));
      assert.ok(err.cause, 'keeps the original error as the cause');
      return true;
    });
    assert.ok(Date.now() - started < 2000);
  });
});

test('fetchWithTimeout also bounds reading a stalled body', async () => {
  await withServer((_req, res) => { res.writeHead(200); res.write('partial'); /* never ends */ }, async base => {
    const res = await fetchWithTimeout(`${base}/stall`, {}, 200);
    await assert.rejects(res.text(), /abort|timeout/i);
  });
});

test('fetchWithTimeout passes through fast responses and wraps connection errors', async () => {
  await withServer((_req, res) => res.end('ok'), async base => {
    const res = await fetchWithTimeout(`${base}/fast`, {}, 1000);
    assert.equal(await res.text(), 'ok');
  });
  await assert.rejects(fetchWithTimeout('http://127.0.0.1:9/closed', {}, 1000), /\(127\.0\.0\.1:9\/closed\)$/);
});
