import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readJsonState, writeJsonAtomic, type StateFs } from '../src/state-file.ts';
import * as fs from 'node:fs';
import { normalizeChangesState } from '../src/changes.ts';
import { normalizeHistoryState } from '../src/history.ts';
import { importAlertState, exportAlertState, resetAlertState } from '../src/alerts.ts';

test('writeJsonAtomic replaces the file whole and leaves no temporary file behind', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'state-'));
  try {
    const file = path.join(dir, 'changes.json');
    writeJsonAtomic(file, { seen: { a: 1 } });
    writeJsonAtomic(file, { seen: { b: 2 } });
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { seen: { b: 2 } });
    assert.deepEqual(readdirSync(dir), ['changes.json']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readJsonState: missing is a first run; a truncated file is reported and set aside, not silently reset', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'state-'));
  const realError = console.error;
  const errors: string[] = [];
  console.error = (msg: string) => { errors.push(msg); };
  try {
    const file = path.join(dir, 'history.json');
    assert.equal(readJsonState(file, 'history'), undefined);
    assert.equal(errors.length, 0, 'a missing file is not an error');

    writeFileSync(file, '{"banks": {"ios:1": {"iOS": "15", "note": "private-value-123');
    assert.equal(readJsonState(file, 'history'), undefined);
    assert.match(errors[0], /\[history\] state file .* is not valid JSON \(SyntaxError\).* moved to .*history\.json\.corrupt-/);
    assert.ok(!errors[0].includes('private-value'), 'the file content never reaches the log');
    assert.ok(!existsSync(file), 'the damaged file was moved aside');
    assert.equal(readdirSync(dir).filter(f => f.startsWith('history.json.corrupt-')).length, 1, 'and kept for recovery');

    writeJsonAtomic(file, { ok: true });
    assert.deepEqual(readJsonState(file, 'history'), { ok: true });
  } finally {
    console.error = realError;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- atomic writes: every failing step leaves the old file and no temporary file ----------

function failing(step: keyof StateFs, failOnCall = 1): { fs: StateFs; closed: () => number } {
  let calls = 0;
  let closes = 0;
  const wrapped = { ...fs } as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const name of ['openSync', 'writeSync', 'fsyncSync', 'closeSync', 'renameSync', 'rmSync'] as const) {
    const real = (fs as unknown as Record<string, (...a: unknown[]) => unknown>)[name];
    wrapped[name] = (...args: unknown[]) => {
      if (name === 'closeSync') closes++;
      if (name === step && ++calls === failOnCall) throw Object.assign(new Error(`${name} failed`), { code: 'EIO' });
      return real(...args);
    };
  }
  return { fs: wrapped as unknown as StateFs, closed: () => closes };
}

for (const step of ['openSync', 'writeSync', 'fsyncSync', 'closeSync', 'renameSync'] as const) {
  test(`writeJsonAtomic: when ${step} fails the old state is kept, no .tmp is left and the descriptor is closed`, () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'state-'));
    try {
      const file = path.join(dir, 'changes.json');
      writeJsonAtomic(file, { seen: { old: null } });
      const injected = failing(step);
      assert.throws(() => writeJsonAtomic(file, { seen: { new: null } }, injected.fs), new RegExp(`${step} failed`));
      assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { seen: { old: null } }, 'the valid state is untouched');
      assert.deepEqual(readdirSync(dir), ['changes.json'], 'no temporary file left behind');
      if (step === 'writeSync' || step === 'fsyncSync') assert.ok(injected.closed() >= 1, 'the open descriptor was closed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('writeJsonAtomic: a directory sync the file system refuses does not fail the write', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'state-'));
  try {
    const file = path.join(dir, 'history.json');
    // The second fsync is the directory's
    writeJsonAtomic(file, { ok: 1 }, failing('fsyncSync', 2).fs);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { ok: 1 });
    assert.deepEqual(readdirSync(dir), ['history.json']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- reading: structure checks and recovery ----------

function withStateFile(content: string, run: (file: string, logs: string[]) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), 'state-'));
  const logs: string[] = [];
  const [realError, realWarn] = [console.error, console.warn];
  console.error = (m: string) => { logs.push(m); };
  console.warn = (m: string) => { logs.push(m); };
  try {
    const file = path.join(dir, 'state.json');
    writeFileSync(file, content);
    run(file, logs);
  } finally {
    console.error = realError;
    console.warn = realWarn;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('changes state: an old file without the pending queue loads as it was', () => {
  withStateFile(JSON.stringify({ baselineAt: '2026-01-01T00:00:00Z', seen: { a: null, b: '2026-02-01T00:00:00Z' } }), (file, logs) => {
    assert.deepEqual(readJsonState(file, 'changes', normalizeChangesState), { baselineAt: '2026-01-01T00:00:00Z', seen: { a: null, b: '2026-02-01T00:00:00Z' } });
    assert.deepEqual(logs, []);
  });
});

test('changes state: without a seen list the baseline is dropped too, so the next run does not announce everything', () => {
  withStateFile(JSON.stringify({ baselineAt: '2026-01-01T00:00:00Z' }), (file, logs) => {
    assert.deepEqual(readJsonState(file, 'changes', normalizeChangesState), { seen: {} });
    assert.match(logs[0], /baselineAt \(no seen list: starting a new baseline\)/);
  });
});

test('changes state: wrong-typed entries are dropped and reported by name and count, never by value', () => {
  const pending = [{ id: 'x', kind: 'deadline', platform: 'iOS', title: 'T', detail: 'D', url: 'https://e', date: '2026-01-01' }, { id: 7 }];
  withStateFile(JSON.stringify({ baselineAt: 42, seen: { a: null, b: 12, c: { secret: 'token-value' } }, pending }), (file, logs) => {
    const state = readJsonState(file, 'changes', normalizeChangesState)!;
    assert.deepEqual(state.seen, { a: null });
    assert.equal(state.baselineAt, undefined);
    assert.equal(state.pending?.length, 1);
    assert.match(logs[0], /reset or dropped 2 entries of seen, baselineAt, 1 entries of pending/);
    assert.ok(!logs.join(' ').includes('token-value'));
  });
});

test('changes state: a seen list of the wrong type, or a file that is not an object, is set aside', () => {
  for (const content of [JSON.stringify({ seen: ['a', 'b'] }), '[1,2,3]', '"text"', 'null']) {
    withStateFile(content, (file, logs) => {
      assert.equal(readJsonState(file, 'changes', normalizeChangesState), undefined, content);
      assert.match(logs[0], /does not have the expected structure; starting from an empty state, the damaged file was moved to .*\.corrupt-/);
      assert.ok(!fs.existsSync(file));
    });
  }
});

test('history state: older files without counts or snapshots load; wrong types reset; bad entries dropped', () => {
  const old = { banks: { 'ios:1': { iOS: '15.0' } }, bankChanges: [], versions: { iosStable: { value: '26.0' } } };
  withStateFile(JSON.stringify(old), (file, logs) => {
    assert.deepEqual(readJsonState(file, 'history', normalizeHistoryState), { ...old, bankSnapshots: [], counts: {} });
    assert.deepEqual(logs, [], 'missing fields of an older version are not a problem');
  });
  const broken = {
    banks: { 'ios:1': { iOS: '15.0' }, 'ios:2': { iOS: 15 } },
    bankChanges: 'none',
    bankSnapshots: [{ date: '2026-10-01', iOS: { 15: 3 }, Android: { 8: 2 } }, { date: 5 }],
    versions: { iosStable: { value: '26.0', pending: { value: '25.0', seen: 1 } }, agpStable: { value: 9 } },
    counts: { 'twBanks.apps': { value: 26 }, bad: { value: 'many' } },
  };
  withStateFile(JSON.stringify(broken), (file, logs) => {
    const state = readJsonState(file, 'history', normalizeHistoryState)!;
    assert.deepEqual(Object.keys(state.banks), ['ios:1']);
    assert.deepEqual(state.bankChanges, []);
    assert.equal(state.bankSnapshots.length, 1);
    assert.deepEqual(Object.keys(state.versions), ['iosStable']);
    assert.deepEqual(Object.keys(state.counts), ['twBanks.apps']);
    assert.match(logs[0], /1 entries of banks, bankChanges, 1 entries of bankSnapshots, 1 entries of versions, 1 entries of counts/);
  });
});

test('alert state: well-formed streaks are restored, malformed ones skipped with a count, a non-object ignored', () => {
  const logs: string[] = [];
  const realWarn = console.warn;
  console.warn = (m: string) => { logs.push(m); };
  try {
    resetAlertState();
    importAlertState({
      ios: { ok: false, since: '2026-10-01T00:00:00Z', failures: 2, issueNotifiedOk: false },
      android: { ok: 'no', since: 'x', failures: 1 },
      crashes: { ok: true },
    });
    assert.deepEqual(Object.keys(exportAlertState()), ['ios']);
    assert.match(logs[0], /skipped 2 saved alert state entries of the wrong shape/);
    importAlertState(['not', 'an', 'object']);
    assert.match(logs[1], /not an object/);
  } finally {
    console.warn = realWarn;
    resetAlertState();
  }
});
