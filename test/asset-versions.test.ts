import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPONENT_DIR, COMPONENT_SCRIPTS, contentVersion, copyComponentScripts, isScript, PUBLIC_DIR, readScript, SCRIPT_VERSIONS, SCRIPTS, scriptPath, scriptSrc } from '../src/asset-versions.ts';
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

test('one resolver says where each script lives: the components compiled in dist/browser/, the rest in public/', () => {
  assert.equal(PUBLIC_DIR, path.join(ROOT, 'public'));
  assert.equal(COMPONENT_DIR, path.join(ROOT, 'dist', 'browser'));
  for (const name of SCRIPTS) {
    const component = (COMPONENT_SCRIPTS as readonly string[]).includes(name);
    assert.equal(scriptPath(name), path.join(component ? COMPONENT_DIR : PUBLIC_DIR, name), name);
    assert.deepEqual(readScript(name), readFileSync(scriptPath(name)), name);
    assert.ok(isScript(name), name);
  }
  assert.deepEqual(SCRIPTS.filter(name => !(COMPONENT_SCRIPTS as readonly string[]).includes(name)), ['theme.js', 'notifications.js', 'app.js']);
  for (const name of ['sw.js', 'manifest.webmanifest', 'choice-chips.ts', 'browser/bank-table.js', '']) assert.equal(isScript(name), false, name);
});

test('the static build copies the compiled component scripts to the site root, after public/ and before its check', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'components-'));
  try {
    await copyComponentScripts(dir);
    for (const name of COMPONENT_SCRIPTS) assert.deepEqual(readFileSync(path.join(dir, name)), readScript(name), name);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const build = readFileSync(new URL('../src/build-static.ts', import.meta.url), 'utf8');
  const order = ["cp(path.join(ROOT, 'public'), dir", 'copyComponentScripts(dir)', 'verify: dir => requireFiles(dir, [\'index.html\', \'style.css\', ...SCRIPTS'].map(s => build.indexOf(s));
  assert.ok(order.every(i => i >= 0), 'all three steps present');
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'public/, then the components, then the check that every script is there');
});

test('every page script is versioned from the file the resolver names, as the stylesheet is', () => {
  for (const name of SCRIPTS) {
    assert.equal(SCRIPT_VERSIONS[name], contentVersion(readFileSync(scriptPath(name))), name);
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

test('the component scripts are page scripts, loaded deferred before app.js on the home page', async () => {
  for (const name of COMPONENT_SCRIPTS) assert.ok((SCRIPTS as readonly string[]).includes(name), name);
  assert.equal(SCRIPTS.at(-1), 'app.js', 'app.js last');
  const { renderHTML } = await import('../src/render.ts');
  const snapshot = JSON.parse(readFileSync(new URL('./fixtures/all-versions.json', import.meta.url), 'utf8'));
  const html = renderHTML(snapshot);
  const tags = html.match(/<script src="[^"]+"[^>]*><\/script>/g) ?? [];
  const order = [...COMPONENT_SCRIPTS, 'app.js'].map(name => {
    const tag = `<script src="${scriptSrc(name)}" defer></script>`;
    assert.ok(tags.includes(tag), `${name} linked with its version and defer`);
    return tags.indexOf(tag);
  });
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'components first, app.js after them');
});
