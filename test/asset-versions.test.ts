import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_PARTS, COMPONENT_DIR, contentVersion, isScript, PUBLIC_DIR, readPart, readScript, SCRIPT_VERSIONS, SCRIPTS, scriptSrc, writeAppScript } from '../src/asset-versions.ts';
import { STYLE_VERSION, PAGE_CSS } from '../src/render-styles.ts';
import { LEGAL_PAGES, renderLegalPage } from '../src/legal-pages.ts';

test('a content version is stable for the same content and changes with any change', () => {
  const app = readScript('app.js');
  assert.equal(contentVersion(app), contentVersion(Buffer.from(app)), 'same bytes, same version');
  assert.equal(contentVersion('console.log(1)'), contentVersion('console.log(1)'));
  assert.notEqual(contentVersion('console.log(1)'), contentVersion('console.log(2)'));
  assert.notEqual(contentVersion(Buffer.concat([app, Buffer.from(' ')])), contentVersion(app), 'one byte more, a new version');
  assert.match(contentVersion(app), /^[0-9a-f]{10}$/);
});

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('one reader says where each script comes from: app.js joined from its compiled parts in dist/browser/, theme.js from public/', () => {
  assert.equal(PUBLIC_DIR, path.join(ROOT, 'public'));
  assert.equal(COMPONENT_DIR, path.join(ROOT, 'dist', 'browser'));
  assert.deepEqual(SCRIPTS, ['theme.js', 'app.js']);
  assert.deepEqual(readScript('theme.js'), readFileSync(path.join(PUBLIC_DIR, 'theme.js')));
  const app = readScript('app.js').toString();
  for (const part of APP_PARTS) {
    assert.deepEqual(readPart(part), readFileSync(path.join(COMPONENT_DIR, part)), part);
    assert.ok(app.includes(`// ---- ${part} ----\n`) && app.includes(readPart(part).toString()), `${part}: in app.js, marked`);
  }
  for (const name of SCRIPTS) assert.ok(isScript(name), name);
  for (const name of ['sw.js', 'manifest.webmanifest', 'notifications.js', 'choice-chips.js', 'page.js', 'browser/bank-table.js', '']) assert.equal(isScript(name), false, name);
  assert.ok(!existsSync(path.join(PUBLIC_DIR, 'app.js')) && !existsSync(path.join(PUBLIC_DIR, 'notifications.js')), 'no hand-kept copy in public/');
});

test('the static build writes app.js to the site root, after public/ and before its check', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'app-script-'));
  try {
    await writeAppScript(dir);
    assert.deepEqual(readFileSync(path.join(dir, 'app.js')), readScript('app.js'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const build = readFileSync(new URL('../src/build-static.ts', import.meta.url), 'utf8');
  const order = ["cp(path.join(ROOT, 'public'), dir", 'writeAppScript(dir)', 'verify: dir => requireFiles(dir, [\'index.html\', \'style.css\', ...SCRIPTS'].map(s => build.indexOf(s));
  assert.ok(order.every(i => i >= 0), 'all three steps present');
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'public/, then app.js, then the check that every script is there');
});

test('every page script is versioned from the file the resolver names, as the stylesheet is', () => {
  for (const name of SCRIPTS) {
    assert.equal(SCRIPT_VERSIONS[name], contentVersion(readScript(name)), name);
    assert.equal(scriptSrc(name), `${name}?v=${SCRIPT_VERSIONS[name]}`);
    assert.equal(scriptSrc(name, '../'), `../${name}?v=${SCRIPT_VERSIONS[name]}`);
  }
  assert.equal(STYLE_VERSION, contentVersion(PAGE_CSS));
});

test('legal pages link the scripts and the stylesheet with the same versions as the home page', () => {
  for (const page of LEGAL_PAGES) {
    const html = renderLegalPage(page, '# t');
    const up = '../'.repeat(page.path.split('/').length - 1);
    assert.ok(html.includes(`<script src="${up}theme.js?v=${SCRIPT_VERSIONS['theme.js']}"></script>`), page.path);
    assert.ok(html.includes(`href="${up}style.css?v=${STYLE_VERSION}"`), page.path);
    assert.ok(!/src="[^"?]+\.js"/.test(html), `${page.path}: no unversioned script`);
  }
});

test('the home page links theme.js in <head> and app.js deferred, both versioned, and no other script', async () => {
  const { renderHTML } = await import('../src/render.ts');
  const snapshot = JSON.parse(readFileSync(new URL('./fixtures/all-versions.json', import.meta.url), 'utf8'));
  const html = renderHTML(snapshot);
  const tags = html.match(/<script src="[^"]+"[^>]*><\/script>/g) ?? [];
  assert.deepEqual(tags, [`<script src="${scriptSrc('theme.js')}"></script>`, `<script src="${scriptSrc('app.js')}" defer></script>`]);
  assert.ok(html.indexOf(tags[0]) < html.indexOf('</head>'), 'theme.js before the page is drawn');
});
