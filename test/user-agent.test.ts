import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { USER_AGENT } from '../src/net.ts';

/**
 * Every outbound request identifies the project (DISCLAIMER.md section 3 says so): a direct fetch() or
 * https.get() must set the User-Agent itself; fetchWithTimeout(), fetchFeed() and fetchHtml() add it.
 */
const dirs = ['../src/', '../src/fetchers/'];

test('the User-Agent says it is the project\'s automated client, without personal details', () => {
  assert.equal(USER_AGENT, 'Mozilla/5.0 (compatible; os-version-tracker)');
  assert.ok(!/louisxie0830|github\.com|@/.test(USER_AGENT), 'no personal account, link or email');
});

test('every direct fetch() / https.get() in src sets the project User-Agent', () => {
  const missing: string[] = [];
  for (const dir of dirs) {
    const base = new URL(dir, import.meta.url);
    for (const file of readdirSync(base).filter(f => f.endsWith('.ts'))) {
      const source = readFileSync(new URL(file, base), 'utf8');
      // A headers object built once in the file and passed by name
      const sharedHeaders = /const \w*[hH]eaders\b[^=]*=\s*\{[^}]*'User-Agent': USER_AGENT/.test(source);
      for (const m of source.matchAll(/(?<![\w.])(?:fetch|https\.get|https\.request)\(/g)) {
        const line = source.slice(0, m.index).split('\n').length;
        const call = source.slice(m.index, m.index! + 600).split(/\)\s*;|\}\s*\)/)[0];
        // The documentation example inside a template string (render-docs) is not a request
        if (/^\s*const res = await fetch\('\$\{SITE_URL\}/.test(source.split('\n')[line - 1])) continue;
        if (file === 'net.ts') continue; // fetchWithTimeout itself, which adds the User-Agent
        const identified = /'User-Agent'/.test(call) || (sharedHeaders && /\bheaders\b/.test(call)) || /\.\.\.init\b/.test(call);
        if (!identified) missing.push(`${dir.replace('../', '')}${file}:${line}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

/**
 * Requests go through src/net.ts (User-Agent, timeout, per-site limit, retries, errors without query
 * strings). The exceptions, each for a stated reason:
 */
const DIRECT_REQUESTS: Record<string, string> = {
  // Webhook URLs are secrets (the path is the token), so they must never reach net.ts's error messages; the
  // notification queue has its own retry policy (postWithRetry, pending items kept for the next run)
  'changes.ts': 'webhook POST with its own retry policy',
  // The alert webhook (secret URL, as above; a missed alert is re-sent on the next run) and the GitHub
  // issues API, whose create/close calls are POST/PATCH and never retried
  'alerts.ts': 'alert webhook and GitHub issues API',
  // Apple's root CA, which fetch() can't be given without a dependency: the bounded node:https GET used by
  // fetchers/ios.ts (gdmf.apple.com) and check-robots.ts (sets the User-Agent itself)
  'https-get.ts': 'gdmf.apple.com needs the Apple root CA',
};

test('only the listed files make requests outside the shared network layer', () => {
  const direct: string[] = [];
  for (const dir of dirs) {
    const base = new URL(dir, import.meta.url);
    for (const file of readdirSync(base).filter(f => f.endsWith('.ts') && f !== 'net.ts')) {
      const source = readFileSync(new URL(file, base), 'utf8')
        .replace(/^const res = await fetch\('\$\{SITE_URL\}.*$/m, ''); // the documentation example in render-docs
      // A call, or a reference handed on (get = https.get); a type (typeof https.get) is not a request
      if (/(?<![\w.])(?:fetch\(|(?<!typeof )https?\.(?:get|request)\b)/.test(source)) direct.push(file);
    }
  }
  assert.deepEqual(direct.sort(), Object.keys(DIRECT_REQUESTS).sort());
});

test('fetchers use the shared body helpers instead of their own fetchText / fetchJson wrappers', () => {
  const own: string[] = [];
  for (const dir of dirs) {
    const base = new URL(dir, import.meta.url);
    for (const file of readdirSync(base).filter(f => f.endsWith('.ts') && f !== 'net.ts')) {
      const source = readFileSync(new URL(file, base), 'utf8');
      if (/function (?:fetchText|fetchJson|fetchBytes|getText)\b|\bfetchOk\b/.test(source)) own.push(file);
      // A raw response is only for callers that need it as it is (check-links reads status and final URL)
      if (/\bfetchWithTimeout\(/.test(source) && file !== 'check-links.ts') own.push(`${file} (raw fetchWithTimeout)`);
    }
  }
  assert.deepEqual(own, []);
});
