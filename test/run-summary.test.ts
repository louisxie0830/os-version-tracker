import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRunSummary } from '../src/run-summary.ts';

const at = '2026-10-17T03:17:00.000Z';
const sources = {
  ios: { label: 'Apple 軟體更新目錄', url: 'https://a', fetchedAt: at, ok: true },
  twBanks: { label: '銀行 App | 台灣', url: 'https://b', fetchedAt: at, ok: true },
  androidNews: { label: 'Android Developers Blog', url: 'https://c', fetchedAt: at, ok: false },
};

test('buildRunSummary: failures first, then incomplete, then the rest; with counts, times and reasons', () => {
  const md = buildRunSummary(sources, {
    errors: { androidNews: 'HTTP 404' },
    quality: { twBanks: ['android.updated 有 1/26 個 App 缺值：com.x', 'twBanks.apps：筆數從 26 掉到 9'] },
    counts: { twBanks: { 'twBanks.apps': 26 }, ios: { 'ios.a': 3, 'ios.b': 4 } },
  }, { publish: true, healthy: 2, total: 3, failed: ['androidNews'] });
  const rows = md.split('\n').filter(l => /^\| (❌|⚠️|✅)/.test(l));
  assert.deepEqual(rows, [
    '| ❌ 失敗 | `androidNews` | Android Developers Blog | — | 10/17 11:17 | HTTP 404 |',
    '| ⚠️ 不完整 | `twBanks` | 銀行 App \\| 台灣 | 26 | 10/17 11:17 | android.updated 有 1/26 個 App 缺值：com.x<br>twBanks.apps：筆數從 26 掉到 9 |',
    '| ✅ 正常 | `ios` | Apple 軟體更新目錄 | a 3 · b 4 | 10/17 11:17 |  |',
  ]);
  assert.match(md, /✅ 已發布 · 成功 2\/3 · 失敗 1 · 不完整 1/);
});

test('buildRunSummary: a refused publish says why', () => {
  const md = buildRunSummary(sources, { errors: {}, quality: {}, counts: {} }, { publish: false, healthy: 1, total: 3, failed: [], reason: 'too many sources failed' });
  assert.match(md, /❌ 未發布：too many sources failed · 成功 1\/3/);
});
