import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contentVersion, SCRIPT_VERSIONS, SCRIPTS, scriptSrc } from '../src/asset-versions.ts';
import { STYLE_VERSION, PAGE_CSS } from '../src/render-styles.ts';
import { LEGAL_PAGES, renderLegalPage } from '../src/legal-pages.ts';

test('a content version is stable for the same content and changes with any change', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url));
  assert.equal(contentVersion(app), contentVersion(Buffer.from(app)), 'same bytes, same version');
  assert.equal(contentVersion('console.log(1)'), contentVersion('console.log(1)'));
  assert.notEqual(contentVersion('console.log(1)'), contentVersion('console.log(2)'));
  assert.notEqual(contentVersion(Buffer.concat([app, Buffer.from(' ')])), contentVersion(app), 'one byte more, a new version');
  assert.match(contentVersion(app), /^[0-9a-f]{10}$/);
});

test('every page script is versioned from its own file in public/, as the stylesheet is', () => {
  for (const name of SCRIPTS) {
    assert.equal(SCRIPT_VERSIONS[name], contentVersion(readFileSync(new URL(`../public/${name}`, import.meta.url))), name);
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
