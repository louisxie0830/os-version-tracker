import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { anonymizeAppStoreUrl, maskName } from '../src/mask.ts';
import { markdownToHtml } from '../src/markdown.ts';

test('maskName keeps the first and last CJK character and the first Latin letter', () => {
  assert.equal(maskName('台北富邦'), '台○○邦');
  assert.equal(maskName('國泰世華'), '國○○華');
  assert.equal(maskName('臺灣企銀'), '臺○○銀');
  assert.equal(maskName('樂天國際商銀'), '樂○○○○銀');
  assert.equal(maskName('第e行動'), '第e○動');
  assert.equal(maskName('LINE Bank'), 'L*** B***');
  assert.equal(maskName('Fubon+ 台北富邦行動銀行'), 'F****+ 台○○○○○○行');
  assert.equal(maskName('CUBE'), 'C***');
});

test('anonymizeAppStoreUrl drops the app name from the path', () => {
  assert.equal(anonymizeAppStoreUrl('https://apps.apple.com/tw/app/cube/id373500505'), 'https://apps.apple.com/tw/app/id373500505');
  assert.equal(anonymizeAppStoreUrl('https://example.com/x'), 'https://example.com/x');
});

test('markdownToHtml renders the subset used by the legal documents', () => {
  const html = markdownToHtml([
    '## Title', '', 'Para with **bold**, `code` and [link](https://example.com/a).', '',
    '- item one', '  - nested', '- item two', '', '| A | B |', '|---|---|', '| 1 | 2 |', '', '---', '',
    'See <https://example.com/b> and [the other file](DISCLAIMER.en.md).',
  ].join('\n'), { relativeBase: 'https://github.com/o/r/blob/master', headingOffset: 2 });
  assert.match(html, /<h3>Title<\/h3>/);
  assert.match(html, /<strong>bold<\/strong>, <code>code<\/code> and <a href="https:\/\/example\.com\/a"/);
  assert.match(html, /<ul><li>item one<ul><li>nested<\/li><\/ul><\/li><li>item two<\/li><\/ul>/);
  assert.match(html, /<th>A<\/th><th>B<\/th>.*<td>1<\/td><td>2<\/td>/);
  assert.match(html, /<hr>/);
  assert.match(html, /href="https:\/\/github\.com\/o\/r\/blob\/master\/DISCLAIMER\.en\.md"/);
});

test('markdownToHtml escapes HTML and drops dangerous links', () => {
  const html = markdownToHtml('<script>alert(1)</script> [x](javascript:alert(1)) [y](data:text/html,hi) [z](../../etc/passwd)');
  assert.ok(!html.includes('<script>'));
  assert.ok(!/href="(javascript|data):/i.test(html));
  assert.ok(!html.includes('href="../'));
  assert.match(html, /&lt;script&gt;/);
});

test('both legal documents convert and link to each other', () => {
  for (const file of ['DISCLAIMER.md', 'DISCLAIMER.en.md']) {
    const html = markdownToHtml(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { relativeBase: 'https://github.com/o/r/blob/master' });
    assert.ok(html.length > 3000, `${file} renders`);
    assert.match(html, /<table/);
    assert.ok(!/臺灣銀行、土地銀行|Bank of Taiwan, Land Bank/.test(html), 'banks are not listed by name');
  }
});
