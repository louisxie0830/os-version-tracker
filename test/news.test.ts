import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findAnnouncedDevices, parseNewsFeed, toNewsItems } from '../src/fetchers/news.js';
import type { NewsItem } from '../src/types.js';
import { fixture } from './helpers.js';

const KNOWN = ['iPhone 17', 'iPhone 17 Pro', 'iPhone 17 Pro Max', 'iPhone Air', 'iPhone 18 Pro', 'iPhone 18 Pro Max'];

test('parseNewsFeed: Apple news items with dates and importance', async () => {
  const news = await parseNewsFeed(fixture('apple-news.rss'), 'apple');
  assert.equal(news[0].title, 'Hello Developer: October 2026');
  // Apple's titles contain non-breaking spaces ("iPhone\u00a0Duo")
  const duo = news.find(n => /^Prepare and submit your apps for iPhone\sDuo$/.test(n.title));
  assert.ok(duo);
  assert.equal(duo.url, 'https://developer.apple.com/news/?id=kkphp5qo');
  assert.equal(duo.date, '2026-10-05');
  assert.equal(duo.important, true);
  assert.equal(news.find(n => n.title.startsWith('Upcoming SDK minimum'))?.important, true);
});

test('findAnnouncedDevices: finds iPhone Duo from the real feed', async () => {
  const news = await parseNewsFeed(fixture('apple-news.rss'), 'apple');
  const devices = findAnnouncedDevices(news, KNOWN);
  assert.deepEqual(devices.map(d => d.name), ['iPhone Duo']);
  // The first post about it (September), not the newest (October)
  assert.equal(devices[0].title, 'Resources for iPhone Duo');
  assert.equal(devices[0].date, '2026-09-18');
});

test('findAnnouncedDevices: ignores known models (case/space-insensitive) and dedupes', () => {
  const item = (title: string): NewsItem => ({ title, url: `https://example.com/${title.length}`, date: '2026-09-09', important: false });
  const news = [
    item('Get ready for iPhone 17 Pro Max and iPhone Air'),
    item('Build for iPhone  duo with new resources'),
    item('Prepare and submit your apps for iPhone Duo'),
    item('Get ready for iPhone Duo'),
    item('Introducing iPhone 19 Ultra'),
  ];
  const devices = findAnnouncedDevices(news, [...KNOWN, 'iPhone duo']);
  assert.deepEqual(devices.map(d => d.name), ['iPhone 19 Ultra']);

  const unknownDuo = findAnnouncedDevices(news.slice(2), KNOWN);
  assert.deepEqual(unknownDuo.map(d => d.name), ['iPhone Duo', 'iPhone 19 Ultra']);
  assert.equal(unknownDuo[0].title, 'Prepare and submit your apps for iPhone Duo');
});

test('an empty feed is reported as a failure', async () => {
  assert.throws(() => toNewsItems([], /x/), /parsed empty/);
  await assert.rejects(parseNewsFeed('<rss version="2.0"><channel><title>t</title></channel></rss>', 'apple'), /parsed empty/);
});

test('toNewsItems: a post whose text asks developers to act is important even when its title doesn\'t say so', () => {
  const [domain, plain] = toNewsItems([
    { title: 'New domain for Sign in with Apple', link: 'https://developer.apple.com/news/?id=1', pubDate: 'Mon, 05 Oct 2026 10:00:00 PDT', contentSnippet: 'Relay addresses will use private.icloud.com. What you need to do: make sure your email validation accepts the new domain.' },
    { title: 'Behind the design: a great app', link: 'https://developer.apple.com/news/?id=2', pubDate: 'Mon, 05 Oct 2026 10:00:00 PDT', contentSnippet: 'Meet the team behind it.' },
  ], /requirement/i);
  assert.equal(domain.important, true);
  assert.equal(plain.important, false);
});
