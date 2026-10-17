import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { formatResults, missingRefs, probePage } from '../src/check-page.ts';

test('probePage drops the CSP (it forbids the inline probe) and runs the probe first in <head>', () => {
  const html = '<html><head><meta http-equiv="Content-Security-Policy" content="script-src \'self\'"><script src="theme.js"></script></head><body><p>x</p></body></html>';
  const out = probePage(html, 'PROBE()');
  assert.ok(!out.includes('Content-Security-Policy'));
  assert.match(out, /^<html><head><script>PROBE\(\)<\/script><script src="theme.js">/);
});

test('missingRefs: local files that are not in the site, ignoring query strings and the page itself', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'check-page-'));
  mkdirSync(path.join(dir, 'api'));
  writeFileSync(path.join(dir, 'style.css'), '');
  writeFileSync(path.join(dir, 'api', 'now.json'), '{}');
  try {
    assert.deepEqual(missingRefs(dir, ['style.css?v=abc', 'api/now.json', './', 'app.js', 'icons/x.svg#a']), ['app.js', 'icons/x.svg#a']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('formatResults: passes only when every run is clean', () => {
  const clean = { width: 390, theme: 'light', issues: {}, errors: [] };
  assert.equal(formatResults([clean]).ok, true);
  const bad = formatResults([clean, { width: 390, theme: 'dark', issues: { 'low text contrast': ['x 2.1:1'] }, errors: ['boom'] }]);
  assert.equal(bad.ok, false);
  assert.match(bad.text, /✖ 390px dark:\n  script errors:\n    boom\n  low text contrast:\n    x 2\.1:1/);
});
