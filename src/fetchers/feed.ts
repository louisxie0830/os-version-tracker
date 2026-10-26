import { gunzipSync } from 'node:zlib';
import RssParser from 'rss-parser';
import { fetchBytes, NETWORK_TIMEOUT_MS } from '../net.js';

/**
 * Downloads an RSS / Atom feed with our own fetch (time limit, the project's User-Agent, body always read)
 * and only then parses it. rss-parser's own parseURL() leaves a connection open when a feed fails to
 * parse after a redirect, which kept the static build's process alive until the CI timeout.
 */
type Feed = RssParser.Output<Record<string, unknown>>;

/**
 * Several sections read the same feed (Apple News: news, deadlines and developer news; the Android blog:
 * news, developer news and Android betas). Inside one refresh (a feed scope, opened by fetch-all) every
 * caller shares one download, so each feed is requested once; each caller still parses the result and
 * reports its own source's status. When the refresh ends the shared downloads are dropped, so the next
 * refresh always downloads afresh. Outside a scope nothing is shared.
 */
const shared = new Map<string, Promise<unknown>>();
let openScopes = 0;

/** Opens a feed scope for one refresh; call the returned function when the refresh is done */
export function beginFeedScope(): () => void {
  openScopes++;
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    if (--openScopes === 0) shared.clear();
  };
}

/**
 * One download per key inside a scope, shared by every caller; outside a scope, a download per call. Pages
 * as well as feeds: AGP's release notes page, for one, is read by both the compatibility and the JDK tables
 */
export function sharedDownload<T>(key: string, download: () => Promise<T>): Promise<T> {
  if (openScopes === 0) return download();
  let pending = shared.get(key) as Promise<T> | undefined;
  if (!pending) {
    pending = download();
    shared.set(key, pending);
  }
  return pending;
}

export function fetchFeed(url: string): Promise<Feed> {
  return sharedDownload(`feed ${url}`, () => downloadFeed(url));
}

/** For tests: forget shared downloads and scopes */
export function resetFeedCache(): void {
  shared.clear();
  openScopes = 0;
}

async function downloadFeed(url: string): Promise<Feed> {
  const bytes = await fetchBytes(url, { headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } }, NETWORK_TIMEOUT_MS, status => `HTTP ${status}`);
  // An Atom entry's <published> as written (rss-parser's pubDate / isoDate are converted to UTC, which moves an
  // evening post in the publisher's time zone to the next day)
  return new RssParser<Record<string, unknown>, Record<string, unknown>>({ customFields: { item: ['published'] } }).parseString(decodeFeedBody(bytes));
}

/** Some servers (e.g. swift.org) send gzip bytes without a Content-Encoding header */
export function decodeFeedBody(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes);
  return (buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer) : buffer).toString('utf8').replace(/^﻿/, '');
}
