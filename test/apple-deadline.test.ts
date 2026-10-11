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
  assert.deepEqual(await parseAppleSubmissionFeed(fixture('apple-news.rss')), SDK_REQUIREMENTS);
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
