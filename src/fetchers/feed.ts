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
const shared = new Map<string, Promise<Feed>>();
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

export function fetchFeed(url: string): Promise<Feed> {
  if (openScopes === 0) return downloadFeed(url);
  let feed = shared.get(url);
  if (!feed) {
    feed = downloadFeed(url);
    shared.set(url, feed);
  }
  return feed;
}

/** For tests: forget shared downloads and scopes */
export function resetFeedCache(): void {
  shared.clear();
  openScopes = 0;
}

async function downloadFeed(url: string): Promise<Feed> {
  const bytes = await fetchBytes(url, { headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } }, NETWORK_TIMEOUT_MS, status => `HTTP ${status}`);
  return new RssParser().parseString(decodeFeedBody(bytes));
}

/** Some servers (e.g. swift.org) send gzip bytes without a Content-Encoding header */
export function decodeFeedBody(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes);
  return (buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer) : buffer).toString('utf8').replace(/^﻿/, '');
}
