import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRobots, concreteUrl, isAllowed, rulesFor, summaryMarkdown } from '../src/check-robots.ts';
import type { SourceRecord } from '../src/source-registry.ts';

test('rulesFor picks our own group when there is one, else the "*" group', () => {
  const robots = `User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private/\nAllow: /private/ok\n\n# comment\nUser-agent: os-version-tracker\nUser-agent: other\nDisallow: /mine`;
  assert.deepEqual(rulesFor(robots), [{ allow: false, path: '/mine' }]);
  assert.deepEqual(rulesFor(robots, 'somebot'), [{ allow: false, path: '/private/' }, { allow: true, path: '/private/ok' }]);
  assert.deepEqual(rulesFor('User-agent: *\nDisallow:'), [], 'an empty Disallow allows everything');
});

test('isAllowed: longest match wins, allow wins a tie, * and $ patterns', () => {
  const rules = rulesFor('User-agent: *\nDisallow: /docs/\nAllow: /docs/public/\nDisallow: /*.json$\nDisallow: /x\nAllow: /x');
  assert.equal(isAllowed(rules, 'https://e.com/docs/secret'), false);
  assert.equal(isAllowed(rules, 'https://e.com/docs/public/page'), true, 'the longer allow wins');
  assert.equal(isAllowed(rules, 'https://e.com/api/data.json'), false);
  assert.equal(isAllowed(rules, 'https://e.com/api/data.json?v=1'), true, '$ anchors the end');
  assert.equal(isAllowed(rules, 'https://e.com/x'), true, 'allow wins a tie');
  assert.equal(isAllowed(rules, 'https://e.com/other'), true);
  assert.equal(isAllowed(rulesFor('User-agent: *\nDisallow: /'), 'https://dl.google.com/a.xml'), false);
});

test('concreteUrl cuts templates at the placeholder', () => {
  assert.equal(concreteUrl('https://registry.npmjs.org/{package}/latest'), 'https://registry.npmjs.org/');
  assert.equal(concreteUrl('https://gs.statcounter.com/chart.php?…&csv=1'), 'https://gs.statcounter.com/chart.php?');
  assert.equal(concreteUrl('https://e.com/a'), 'https://e.com/a');
});

test('checkRobots: disallowed, disclosed exceptions, missing and unreachable robots.txt', async () => {
  const register = {
    a: { licence: 'x', risk: 'low', note: 'x', endpoints: [
      { url: 'https://open.example/feed.xml', method: 'RSS / Atom', terms: 'https://t' },
      { url: 'https://closed.example/data.json', method: 'JSON 檔', terms: 'https://t' },
      { url: 'https://closed.example/meta.xml', method: 'XML 檔', terms: 'https://t', robotsException: 'tooling repository' },
      { url: 'https://none.example/x', method: 'API', terms: 'https://t' },
      { url: 'https://down.example/x', method: 'API', terms: 'https://t' },
    ] },
  } as Record<string, SourceRecord>;
  const robots: Record<string, { status: number; body: string }> = {
    'https://open.example/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /admin' },
    'https://closed.example/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /' },
    'https://none.example/robots.txt': { status: 404, body: '' },
    'https://down.example/robots.txt': { status: 0, body: '' },
  };
  const { results, snapshots } = await checkRobots(register, async url => robots[url]);
  assert.deepEqual(results.map(r => r.verdict), ['allowed', 'disallowed', 'excepted', 'allowed', 'unreachable']);
  assert.equal(snapshots.size, 4, 'one robots.txt per host');
  const md = summaryMarkdown(results, '2026-10-17T00:00:00Z');
  assert.match(md, /\*\*2 個有問題\*\* · 1 個已揭露的例外/);
  assert.ok(md.indexOf('被禁止') < md.indexOf('已揭露的例外）'), 'problems listed first');
});
