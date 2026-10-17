import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { androidxTitle, decodeFeedBody, fetchDevNews, mergeNews, NEWS_SOURCES, parseSourceItems, type DevNewsItem } from '../src/fetchers/dev-news.ts';

const source = (id: string) => NEWS_SOURCES.find(s => s.id === id)!;

test('decodeFeedBody handles gzip bytes without a Content-Encoding header and a BOM', () => {
  const xml = '<?xml version="1.0"?><feed></feed>';
  assert.equal(decodeFeedBody(gzipSync(Buffer.from(xml))), xml);
  assert.equal(decodeFeedBody(Buffer.from(`﻿${xml}`)), xml);
});

test('AndroidX entries are titled by their libraries, stable releases first', () => {
  const content = '<ul><li><a href="x">Compose Animation Version 1.13.0-beta01</a></li><li><a href="y">Collection Version 1.7.0</a></li>'
    + '<li><a href="z">Paging Version 3.5.2</a></li><li><a href="w">Room Version 2.9.0-alpha02</a></li></ul>';
  assert.deepEqual(androidxTitle({ content, link: 'https://developer.android.com/x' }), {
    title: 'AndroidX: Collection 1.7.0, Paging 3.5.2, Compose Animation 1.13.0-beta01 +1 more',
    url: 'https://developer.android.com/x',
  });
  assert.equal(androidxTitle({ content: '<p>nothing</p>' }), null);
});

test('parseSourceItems filters, flags importance and drops unsafe or undated items', () => {
  const apple = parseSourceItems(source('apple-releases'), [
    { title: 'Xcode 27 (27A266a)', link: 'https://developer.apple.com/r/1', isoDate: '2026-09-14T00:00:00Z' },
    { title: 'iOS 27.2 beta 3 (24B5099f)', link: 'https://developer.apple.com/r/2', isoDate: '2026-10-05T00:00:00Z' },
    { title: 'macOS 27.2 beta 3 (26B5101f)', link: 'https://developer.apple.com/r/3', isoDate: '2026-10-05T00:00:00Z' },
    { title: 'iOS 27.1 (24B10)', link: 'javascript:alert(1)', isoDate: '2026-10-01T00:00:00Z' },
    { title: 'TestFlight Update', link: 'https://developer.apple.com/r/4' },
  ]);
  assert.deepEqual(apple.map(i => [i.title, i.important]), [['Xcode 27 (27A266a)', true], ['iOS 27.2 beta 3 (24B5099f)', false]]);

  const studio = parseSourceItems(source('android-studio'), [
    { title: 'Android Studio Rabbit 1 now available', link: 'https://a.example/1', isoDate: '2026-10-01T00:00:00Z' },
    { title: 'Android Studio Rabbit 2 Canary 4 now available', link: 'https://a.example/2', isoDate: '2026-10-08T00:00:00Z' },
  ]);
  assert.deepEqual(studio.map(i => i.important), [true, false]);

  const firebase = parseSourceItems(source('firebase'), [
    { title: 'Google Analytics for Firebase iOS SDK outage on September 28, 2026', link: 'https://firebase.blog/x', isoDate: '2026-10-02T00:00:00Z' },
  ]);
  assert.equal(firebase[0].important, true, 'outages are flagged by the shared rules');
  assert.equal(firebase[0].platform, '跨平台');
});

const item = (id: string, date: string, url = `https://example.com/${id}`): DevNewsItem =>
  ({ id, source: id.split(':')[0], platform: 'iOS', category: 'blog', title: id, url, date, important: false });

test('mergeNews: newest first, 60-day window, URL de-duplication and a per-source cap', () => {
  const now = new Date('2026-10-11T00:00:00Z');
  const merged = mergeNews([
    [item('a:1', '2026-10-01'), item('a:old', '2026-07-01'), item('a:dup', '2026-10-03', 'https://example.com/same')],
    [item('b:1', '2026-10-05'), item('b:dup', '2026-10-02', 'https://example.com/same')],
    Array.from({ length: 20 }, (_, i) => item(`c:${i}`, `2026-09-${String(10 + i).padStart(2, '0')}`)),
  ], now, 60, 80, 12);
  assert.deepEqual(merged.slice(0, 3).map(i => i.id), ['b:1', 'a:dup', 'a:1']);
  assert.ok(!merged.some(i => i.id === 'a:old'), 'older than 60 days');
  assert.equal(merged.filter(i => i.url === 'https://example.com/same').length, 1);
  assert.equal(merged.filter(i => i.id.startsWith('c:')).length, 12);
});

test('fetchDevNews keeps partial results and fails only when every feed fails', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const sources = [source('swift'), source('kotlin')];
    const recent = new Date().toISOString().slice(0, 10);
    const partial = await fetchDevNews(sources, async s => {
      if (s.id === 'swift') throw new Error('HTTP 503');
      return [item('kotlin:1', recent)];
    });
    assert.equal(partial.length, 1);
    await assert.rejects(fetchDevNews(sources, async () => { throw new Error('offline'); }), /dev news: every upstream failed/);
  } finally {
    console.warn = warn;
  }
});
