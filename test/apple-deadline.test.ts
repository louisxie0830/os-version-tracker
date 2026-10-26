import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAppleSubmissionFeed,
  parseAppleSubmissionFeedItems,
  parseAppleSubmissionText,
} from '../src/fetchers/apple-deadline.js';
import { fixture } from './helpers.js';

const SDK_REQUIREMENTS = {
  source: 'apple',
  deadline: 'April 28, 2026',
  announcedAt: '2026-02-03',
  requirements: [
    { platform: 'iOS and iPadOS', sdk: 'iOS 26 & iPadOS 26 SDK or later' },
    { platform: 'tvOS', sdk: 'tvOS 26 SDK or later' },
    { platform: 'visionOS', sdk: 'visionOS 26 SDK or later' },
    { platform: 'watchOS', sdk: 'watchOS 26 SDK or later' },
  ],
};

test('parseAppleSubmissionFeed: finds the SDK requirements post in the news RSS', async () => {
  assert.deepEqual(await parseAppleSubmissionFeed(fixture('apple-news.rss')), { ...SDK_REQUIREMENTS, url: 'https://developer.apple.com/news/?id=test0008' }, 'with the post that announced it');
});

test('parseAppleSubmissionText: plain post text', () => {
  const text = 'Starting April 28, 2026, apps and games uploaded to App Store Connect need to meet the following minimum requirements:\n' +
    'iOS and iPadOS apps must be built with the iOS 26 & iPadOS 26 SDK or later\n' +
    'tvOS apps must be built with the tvOS 26 SDK or later\n' +
    'visionOS apps must be built with the visionOS 26 SDK or later\n' +
    'watchOS apps must be built with the watchOS 26 SDK or later\n' +
    'Learn more about submitting';
  assert.deepEqual(parseAppleSubmissionText(text, 'Tue, 03 Feb 2026 06:00:30 PST'), SDK_REQUIREMENTS);
  assert.equal(parseAppleSubmissionText(text).announcedAt, 'unknown');
});

test('no SDK requirements post → null (nothing announced), unreadable post → throws', () => {
  assert.equal(parseAppleSubmissionFeedItems([{ title: 'Hello Developer', contentSnippet: 'News' }]), null);
  assert.throws(
    () => parseAppleSubmissionFeedItems([{ title: 'Upcoming SDK minimum requirements', contentSnippet: 'Coming soon, see our website.' }]),
    /no "Starting <date>"/,
  );
  assert.throws(
    () => parseAppleSubmissionText('Starting April 28, 2026, apps need Xcode 26.'),
    /without requirements/,
  );
});

test('the SDK minimum inside another post, by month only: picked by what it says, dated the month\'s first day', () => {
  const items = [
    { title: 'Offer your subscriptions to businesses', contentSnippet: 'Starting today, organizations can purchase subscriptions.', pubDate: 'Thu, 22 Oct 2026 11:00:08 PDT' },
    { title: 'App Store submissions now open for the latest OS releases', pubDate: 'Wed, 09 Sep 2026 16:00:38 PDT',
      contentSnippet: 'Coming soon.\nStarting April 2027 , apps and games uploaded to App Store Connect need to meet the following minimum requirements:\niOS and iPadOS apps must be built with the iOS 27 & iPadOS 27 SDK or later\ntvOS apps must be built with the tvOS 27 SDK or later' },
    { title: 'Upcoming SDK minimum requirements', pubDate: 'Tue, 03 Feb 2026 06:00:30 PST',
      contentSnippet: 'Starting April 28, 2026, apps and games uploaded to App Store Connect need to meet the following minimum requirements:\niOS and iPadOS apps must be built with the iOS 26 & iPadOS 26 SDK or later' },
  ];
  const found = parseAppleSubmissionFeedItems(items)!;
  assert.equal(found.deadline, 'April 1, 2027');
  assert.equal(found.datePrecision, 'month');
  assert.equal(found.announcedAt, '2026-09-09');
  assert.deepEqual(found.requirements[0], { platform: 'iOS and iPadOS', sdk: 'iOS 27 & iPadOS 27 SDK or later' });
  assert.equal(parseAppleSubmissionFeedItems(items.slice(2))!.datePrecision, undefined, 'an exact day: no precision note');
});

test('a season or other word in place of a month is no date: the post fails loudly instead of "Spring 1, 2027"', () => {
  assert.throws(() => parseAppleSubmissionFeedItems([{ title: 'x', contentSnippet: 'Starting Spring 2027, iOS and iPadOS apps must be built with the iOS 27 SDK or later' }]), /no "Starting <date>"/);
});
