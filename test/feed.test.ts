import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { beginFeedScope, fetchFeed, resetFeedCache, sharedDownload } from '../src/fetchers/feed.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; resetFeedCache(); });

const ATOM = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Blog</title>
  <entry><title>Android 17 is here</title><link href="https://developer.android.com/blog/posts/a"/><updated>2026-10-01T00:00:00Z</updated></entry></feed>`;

function serve(body: BodyInit, init: ResponseInit = {}) {
  const seen: Array<{ url: string; headers: Headers }> = [];
  globalThis.fetch = (async (url: string | URL | Request, req?: RequestInit) => {
    seen.push({ url: String(url), headers: new Headers(req?.headers) });
    return new Response(body, init);
  }) as typeof fetch;
  return seen;
}

test('fetchFeed downloads with the project User-Agent and parses Atom', async () => {
  const seen = serve(ATOM);
  const feed = await fetchFeed('https://developer.android.com/blog/atom.xml');
  assert.equal(feed.items[0].title, 'Android 17 is here');
  assert.equal(feed.items[0].link, 'https://developer.android.com/blog/posts/a');
  assert.match(seen[0].headers.get('User-Agent') ?? '', /os-version-tracker/);
  assert.match(seen[0].headers.get('Accept') ?? '', /atom\+xml/);
});

test('fetchFeed reads gzip bodies sent without Content-Encoding', async () => {
  serve(gzipSync(Buffer.from(ATOM)));
  assert.equal((await fetchFeed('https://example.com/feed')).items.length, 1);
});

test('fetchFeed rejects HTTP errors and pages that are not feeds (e.g. a login page)', async () => {
  serve('gone', { status: 404 });
  await assert.rejects(fetchFeed('https://example.com/feed'), /HTTP 404/);
  serve('<!doctype html><html><body><form>Sign in</form></body></html>');
  await assert.rejects(fetchFeed('https://example.com/feed'));
});

test('inside one refresh scope a feed is downloaded once; after it, and outside any scope, it is downloaded afresh', async () => {
  const seen = serve(ATOM);
  const end = beginFeedScope();
  const [a, b] = await Promise.all([fetchFeed('https://example.com/shared'), fetchFeed('https://example.com/shared')]);
  await fetchFeed('https://example.com/shared');
  assert.equal(seen.length, 1, 'one request for three readers in the same refresh');
  assert.equal(a, b, 'they share the result (each still parses and reports its own source)');
  end();
  await fetchFeed('https://example.com/shared');
  assert.equal(seen.length, 2, 'the next refresh never reuses the old download');
  await fetchFeed('https://example.com/shared');
  assert.equal(seen.length, 3, 'outside a scope nothing is shared');
});

test('a failed shared download fails every reader in that refresh alike, and the next refresh retries', async () => {
  serve('gone', { status: 404 });
  const end = beginFeedScope();
  await assert.rejects(fetchFeed('https://example.com/flaky'), /HTTP 404/);
  await assert.rejects(fetchFeed('https://example.com/flaky'), /HTTP 404/);
  end();
  const again = serve(ATOM);
  const endNext = beginFeedScope();
  assert.equal((await fetchFeed('https://example.com/flaky')).items.length, 1);
  endNext();
  assert.equal(again.length, 1);
});

test('sharedDownload: one download per key inside a scope, none shared outside it', async () => {
  resetFeedCache();
  let downloads = 0;
  const download = async () => ++downloads;
  assert.equal(await sharedDownload('html a', download), 1);
  assert.equal(await sharedDownload('html a', download), 2, 'no scope: each call downloads');
  const end = beginFeedScope();
  const [x, y] = await Promise.all([sharedDownload('html a', download), sharedDownload('html a', download)]);
  assert.equal(x, y, 'both callers got the one download');
  assert.equal(await sharedDownload('html b', download), 4, 'another key is its own download');
  end();
  assert.equal(await sharedDownload('html a', download), 5, 'a new refresh downloads afresh');
});
