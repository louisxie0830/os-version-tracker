import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadState, refuseNewBaseline, usableState, type RestoreDeps } from '../src/state-restore.ts';

const SITE = 'https://site.example';
/** Files in the "cache" and pages on the "site" (a missing page fails with HTTP 404, others as given) */
function deps(files: Record<string, string>, pages: Record<string, string | Error>, extra: Partial<RestoreDeps> = {}) {
  const log: string[] = [];
  const fetched: string[] = [];
  const d: RestoreDeps = {
    readFile: async file => { if (file in files) return files[file]; throw new Error('ENOENT'); },
    fetchText: async url => {
      fetched.push(url);
      const page = pages[url.slice(SITE.length)];
      if (page instanceof Error) throw page;
      if (page === undefined) throw new Error(`HTTP 404: site.example${url.slice(SITE.length)}`);
      return page;
    },
    siteUrl: SITE,
    allowNewBaseline: false,
    log: line => log.push(line),
    ...extra,
  };
  return { d, log, fetched };
}

test('loadState: the cached copy wins; without it the site\'s copy, with a warning on the run page', async () => {
  const cached = deps({ '.state/changes.json': '{"seen":{"a":null}}' }, {});
  assert.equal(await loadState('.state/changes.json', cached.d), '{"seen":{"a":null}}');
  assert.deepEqual(cached.fetched, []);

  const fromSite = deps({}, { '/state/changes.json': '{"seen":{}}' });
  assert.equal(await loadState('.state/changes.json', fromSite.d), '{"seen":{}}');
  assert.deepEqual(fromSite.log, ['::warning::changes.json was not in the Actions cache; restored from the live site']);

  const neither = deps({}, {});
  assert.equal(await loadState('.state/history.json', neither.d), null);
  assert.deepEqual(neither.log, ['::warning::history.json is in neither the Actions cache nor the live site']);
});

test('loadState: a copy that parses but isn\'t usable state (null, a list, changes without seen) counts as missing', async () => {
  for (const bad of ['null', '[]', '"x"', '{"baselineAt":"2026-01-01"}', 'not json']) {
    const { d } = deps({ '.state/changes.json': bad }, { '/state/changes.json': bad });
    assert.equal(await loadState('.state/changes.json', d), null, bad);
  }
  assert.equal(usableState('history.json', {}), true, 'an empty history is still a history');
  assert.equal(usableState('changes.json', { seen: {} }), true);
});

test('refuseNewBaseline: stops when the site is live, or can\'t be reached; goes on for a first build or on purpose', async () => {
  await refuseNewBaseline([], deps({}, {}).d);

  const live = deps({}, { '/health.json': '{"status":"ok"}' });
  await assert.rejects(refuseNewBaseline(['changes.json'], live.d), /could not be restored while https:\/\/site\.example is live/);

  const blip = deps({}, { '/health.json': new Error('HTTP 503: site.example/health.json') });
  await assert.rejects(refuseNewBaseline(['history.json'], blip.d), /may be live \(it could not be reached\)/, 'a 503 is not "no site"');
  const reset = deps({}, { '/health.json': new Error('read ECONNRESET') });
  await assert.rejects(refuseNewBaseline(['history.json'], reset.d), /may be live/);

  const first = deps({}, {});
  await refuseNewBaseline(['changes.json', 'history.json'], first.d);
  assert.deepEqual(first.log, ['No live site at https://site.example yet: first build, starting a new baseline']);

  const onPurpose = deps({}, { '/health.json': '{}' }, { allowNewBaseline: true });
  await refuseNewBaseline(['changes.json'], onPurpose.d);
  assert.deepEqual(onPurpose.fetched, [], 'the site isn\'t even asked');
  assert.match(onPurpose.log[0], /Starting a new baseline without changes\.json/);
});

test('refuseNewBaseline: a 403 or 401 is not "no site yet"; nothing missing never asks the site at all', async () => {
  for (const status of [403, 401]) {
    const { d } = deps({}, { '/health.json': new Error(`HTTP ${status}: site.example/health.json`) });
    await assert.rejects(refuseNewBaseline(['changes.json'], d), /may be live/, String(status));
  }
  const live = deps({}, { '/health.json': '{}' });
  await refuseNewBaseline([], live.d);
  assert.deepEqual(live.fetched, [], 'a normal build with its state never asks');
});
