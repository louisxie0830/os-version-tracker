import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarSubscriptionUrl, safeUrl } from '../src/safe-url.ts';
import { externalLink } from '../src/render-actions.ts';
import { buildCalendar } from '../src/calendar.ts';
import { buildAtomFeed, buildNotificationsJson, type TrackedItem } from '../src/changes.ts';
import type { Deadline } from '../src/types.ts';

test('safeUrl accepts absolute http(s) URLs only', () => {
  assert.equal(safeUrl('https://developer.apple.com/news/'), 'https://developer.apple.com/news/');
  assert.equal(safeUrl('http://example.com/a?b=1'), 'http://example.com/a?b=1');
  assert.equal(safeUrl('http://example.com', { allowHttp: false }), null);
  for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x', 'file:///etc/passwd',
    'webcal://example.com/x.ics', '/relative/path', 'calendar.ics', '//evil.example.com', 'not a url', '', 'https://user:pw@example.com/']) {
    assert.equal(safeUrl(bad), null, bad);
  }
  assert.equal(safeUrl(undefined), null);
  assert.equal(safeUrl(42), null);
});

test('safeUrl rejects newline / control-character injection', () => {
  for (const bad of ['https://example.com/\r\nATTACH:evil', 'https://example.com/\nX', 'https://exa\tmple.com', 'https://example.com/\u0000']) {
    assert.equal(safeUrl(bad), null, JSON.stringify(bad));
  }
});

test('calendarSubscriptionUrl only derives webcal from an https site URL', () => {
  assert.equal(calendarSubscriptionUrl('https://louisxie0830.github.io/os-version-tracker'), 'webcal://louisxie0830.github.io/os-version-tracker/calendar.ics');
  assert.equal(calendarSubscriptionUrl('http://localhost:3000'), null);
  assert.equal(calendarSubscriptionUrl('javascript:alert(1)'), null);
});

test('externalLink renders unsafe URLs as plain text', () => {
  assert.equal(externalLink('https://example.com/', 'Ok'), '<a href="https://example.com/" target="_blank" rel="noopener noreferrer">Ok</a>');
  assert.equal(externalLink('javascript:alert(1)', 'Click', 'x'), '<span class="x">Click</span>');
  assert.equal(externalLink(undefined, 'None'), '<span>None</span>');
  assert.match(externalLink('https://example.com/?a="b"&c=<d>', 'q'), /href="https:\/\/example\.com\/\?a=%22b%22&amp;c=%3Cd%3E"/);
});

const deadline = (overrides: Partial<Deadline> = {}): Deadline => ({
  platform: 'Android', date: '2027-01-27', title: 'Policy\; change, here', detail: 'Line one\nLine two\rthree', source: 'Google', url: 'https://example.com/p', ...overrides,
});

test('calendar escapes text, folds long lines and never emits raw CR/LF inside a property', () => {
  const ics = buildCalendar([
    deadline({ detail: `${'長'.repeat(60)} https://example.com/${'x'.repeat(80)}` }),
    deadline({ title: 'Injected', url: 'https://example.com/\r\nATTACH:https://evil.example.com' }),
  ], 'https://site.example', new Date('2026-10-11T00:00:00Z'));
  const lines = ics.split('\r\n');
  assert.ok(lines.every(l => Buffer.byteLength(l, 'utf8') <= 75), 'every line folded to 75 octets');
  assert.ok(!/\r(?!\n)|(?<!\r)\n/.test(ics), 'only CRLF line breaks');
  assert.ok(ics.includes('SUMMARY:[Android] Policy\\; change\\, here'), 'semicolons and commas are escaped');
  assert.match(ics, /Line one\\nLine two\\nthree/);
  assert.ok(!ics.includes('ATTACH:'), 'injected property never appears');
  assert.equal(lines.filter(l => l.startsWith('URL:')).length, 1, 'the unsafe URL is omitted, the safe one kept');
  // Unfolding restores the long description intact
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('長'.repeat(60)));
});

let n = 0;
const tracked = (url: string): TrackedItem => ({ id: `item-${++n}`, kind: 'apple-news', platform: 'iOS', title: 't', detail: 'd', url, date: '2026-10-01' });

test('feed and notifications only publish safe links', () => {
  const feed = buildAtomFeed([tracked('javascript:alert(1)'), tracked('https://ok.example/')], 'https://site.example', '2026-10-11T00:00:00Z');
  assert.ok(!/href="(javascript|data):/i.test(feed), 'no active-scheme link');
  assert.equal((feed.match(/<link href=/g) ?? []).length, 2, 'site link + the one safe item');
  assert.match(feed, /<link href="https:\/\/ok\.example\/"\/>/);
  const notifications = JSON.parse(buildNotificationsJson([tracked('data:text/html,x'), tracked('https://ok.example/')], '2026-10-11T00:00:00Z'));
  assert.deepEqual(notifications.items.map((i: { url: string }) => i.url).sort(), ['', 'https://ok.example/']);
});
