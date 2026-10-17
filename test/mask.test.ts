import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { anonymizeAppStoreUrl, maskName } from '../src/mask.ts';

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

test('the legal documents link to each other and do not list banks by name', () => {
  for (const [file, other] of [['DISCLAIMER.md', 'DISCLAIMER.en.md'], ['DISCLAIMER.en.md', 'DISCLAIMER.md']]) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.ok(text.includes(`(${other})`), `${file} links to ${other}`);
    assert.ok(!/臺灣銀行、土地銀行|Bank of Taiwan, Land Bank/.test(text), 'banks are not listed by name');
  }
});
