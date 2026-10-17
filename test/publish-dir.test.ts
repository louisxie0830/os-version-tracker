import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BUILD_MARKER } from '../src/output-dir.ts';
import { buildIntoDirectory, recoverInterrupted, requireFiles, STALE_AFTER_MS, type DirOps } from '../src/publish-dir.ts';

/** A throwaway repository in the temp directory, with a previous build in site/ */
let tmp: string;
let repo: string;
let out: string;
beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ovt-publish-')));
  repo = path.join(tmp, 'repo');
  out = path.join(repo, 'site');
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  writeFileSync(path.join(repo, 'src', 'keep.ts'), '// must survive');
  mkdirSync(out);
  writeFileSync(path.join(out, BUILD_MARKER), '');
  writeFileSync(path.join(out, 'index.html'), 'old page');
  writeFileSync(path.join(out, 'old-only.txt'), 'gone after a successful build');
});
// Only the temp fixture created above
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const siblings = () => readdirSync(repo).sort();
const writeSite = (page: string) => async (dir: string) => { writeFileSync(path.join(dir, 'index.html'), page); };

test('success: the new site completely replaces the old one, and no staging or backup is left', async () => {
  let stagingDir = '';
  await buildIntoDirectory('site', repo, async dir => {
    stagingDir = dir;
    assert.equal(path.dirname(dir), repo, 'staging is a sibling of the output directory');
    assert.ok(existsSync(out), 'the old site stays in place while the new one is written');
    await writeSite('new page')(dir);
  }, { cwd: repo });
  assert.equal(readFileSync(path.join(out, 'index.html'), 'utf8'), 'new page');
  assert.ok(!existsSync(path.join(out, 'old-only.txt')), 'nothing of the old site is mixed in');
  assert.ok(existsSync(path.join(out, BUILD_MARKER)), 'marked for the next build');
  assert.ok(!existsSync(stagingDir));
  assert.deepEqual(siblings(), ['site', 'src']);
  assert.equal(readFileSync(path.join(repo, 'src', 'keep.ts'), 'utf8'), '// must survive');
});

test('a first build (no output directory yet) just moves the staging directory into place', async () => {
  rmSync(out, { recursive: true });
  await buildIntoDirectory('site', repo, writeSite('first'), { cwd: repo });
  assert.equal(readFileSync(path.join(out, 'index.html'), 'utf8'), 'first');
  assert.deepEqual(siblings(), ['site', 'src']);
});

test('a write failure leaves the old site complete and removes the staging directory', async () => {
  await assert.rejects(buildIntoDirectory('site', repo, async dir => {
    writeFileSync(path.join(dir, 'index.html'), 'half');
    throw new Error('disk full');
  }, { cwd: repo }), /disk full/);
  assert.equal(readFileSync(path.join(out, 'index.html'), 'utf8'), 'old page');
  assert.ok(existsSync(path.join(out, 'old-only.txt')));
  assert.deepEqual(siblings(), ['site', 'src']);
});

test('a site that fails verification is never put in place', async () => {
  await assert.rejects(buildIntoDirectory('site', repo, async () => {}, { cwd: repo, verify: dir => requireFiles(dir, ['index.html', 'api.json']) }), /incomplete \(missing or empty: index\.html, api\.json\)/);
  assert.equal(readFileSync(path.join(out, 'index.html'), 'utf8'), 'old page');
  assert.deepEqual(siblings(), ['site', 'src']);
});

test('a failed swap is rolled back: the old site is put back and the staging directory removed', async () => {
  let renames = 0;
  const ops: DirOps = {
    rm,
    // The first rename (old site aside) works; moving the new site into place fails
    rename: async (from, to) => {
      renames++;
      if (renames === 2) throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
      await rename(from, to);
    },
  };
  await assert.rejects(buildIntoDirectory('site', repo, writeSite('new page'), { cwd: repo, ops }), /cross-device/);
  assert.equal(readFileSync(path.join(out, 'index.html'), 'utf8'), 'old page', 'the old site is back');
  assert.ok(existsSync(path.join(out, 'old-only.txt')));
  assert.equal(renames, 3, 'aside, (failed) into place, back');
  assert.deepEqual(siblings(), ['site', 'src'], 'no staging or backup left');
});

test('if even the rollback fails, the backup is kept and the next build restores it first', async () => {
  const ops: DirOps = {
    rm,
    rename: async (from, to) => {
      if (!path.basename(from).includes('.backup-') && path.basename(from) !== 'site') throw new Error('rename refused');
      if (path.basename(from).includes('.backup-')) throw new Error('rename refused');
      await rename(from, to);
    },
  };
  await assert.rejects(buildIntoDirectory('site', repo, writeSite('new page'), { cwd: repo, ops }), /rename refused/);
  assert.ok(!existsSync(out), 'the output directory is missing…');
  const backups = siblings().filter(n => n.startsWith('.site.backup-'));
  assert.equal(backups.length, 1, '…but the old site survives as the backup');
  assert.ok(!siblings().some(n => n.startsWith('.site.staging-')), 'the staging directory is removed');

  // The next build puts the old site back before anything else, then replaces it as usual
  let seen = '';
  await buildIntoDirectory('site', repo, async dir => {
    seen = readFileSync(path.join(out, 'index.html'), 'utf8');
    await writeSite('newer page')(dir);
  }, { cwd: repo });
  assert.equal(seen, 'old page', 'restored from the backup first');
  assert.equal(readFileSync(path.join(out, 'index.html'), 'utf8'), 'newer page');
  assert.deepEqual(siblings(), ['site', 'src']);
});

test('Windows-style transient rename errors are retried', async () => {
  let failures = 0;
  const ops: DirOps = {
    rm,
    rename: async (from, to) => {
      if (failures < 2) {
        failures++;
        throw Object.assign(new Error('resource busy'), { code: 'EBUSY' });
      }
      await rename(from, to);
    },
  };
  await buildIntoDirectory('site', repo, writeSite('new page'), { cwd: repo, ops });
  assert.equal(readFileSync(path.join(out, 'index.html'), 'utf8'), 'new page');
  assert.equal(failures, 2);
});

test('leftovers of a crashed build: stale staging removed, a backup removed when the site exists; others\' folders untouched', async () => {
  const stale = path.join(repo, '.site.staging-999999-dead');
  mkdirSync(stale);
  writeFileSync(path.join(stale, BUILD_MARKER), '');
  const oldBackup = path.join(repo, '.site.backup-999999-dead');
  mkdirSync(oldBackup);
  writeFileSync(path.join(oldBackup, BUILD_MARKER), '');
  // Same prefix but not ours (no marker, not empty): never touched
  const foreign = path.join(repo, '.site.staging-notes');
  mkdirSync(foreign);
  writeFileSync(path.join(foreign, 'notes.md'), 'hand-written');
  const done = await recoverInterrupted(out);
  assert.deepEqual(done.sort(), ['removed .site.backup-999999-dead', 'removed .site.staging-999999-dead']);
  assert.ok(existsSync(path.join(foreign, 'notes.md')));
  assert.equal(readFileSync(path.join(out, 'index.html'), 'utf8'), 'old page');
});

test('a staging directory of a build that is still running is left alone', async () => {
  const running = path.join(repo, `.site.staging-${process.ppid}-live`);
  mkdirSync(running);
  writeFileSync(path.join(running, BUILD_MARKER), '');
  assert.deepEqual(await recoverInterrupted(out), []);
  assert.ok(existsSync(running));
});

test('the safety checks still apply: unsafe or hand-written output directories are refused before anything is written', async () => {
  let wrote = false;
  const write = async () => { wrote = true; };
  for (const unsafe of ['.', 'src', '..', repo]) {
    await assert.rejects(buildIntoDirectory(unsafe, repo, write, { cwd: repo }), /Refusing/, unsafe);
  }
  mkdirSync(path.join(repo, 'docs'));
  writeFileSync(path.join(repo, 'docs', 'notes.md'), 'hand-written');
  await assert.rejects(buildIntoDirectory('docs', repo, write, { cwd: repo }), /marker/);
  assert.equal(wrote, false);
  assert.equal(readFileSync(path.join(repo, 'docs', 'notes.md'), 'utf8'), 'hand-written');
  assert.equal(readFileSync(path.join(repo, 'src', 'keep.ts'), 'utf8'), '// must survive');
  assert.deepEqual(siblings(), ['docs', 'site', 'src']);
});

test('an output directory that turns unsafe while the site is written is not replaced', async () => {
  await assert.rejects(buildIntoDirectory('site', repo, async dir => {
    await writeSite('new page')(dir);
    // Someone replaces site/ with their own files meanwhile
    rmSync(path.join(out, BUILD_MARKER));
  }, { cwd: repo }), /marker/);
  assert.equal(readFileSync(path.join(out, 'index.html'), 'utf8'), 'old page');
  assert.deepEqual(siblings(), ['site', 'src']);
});

// ---------- leases: which leftovers belong to a build still in progress ----------

const NOW = Date.parse('2026-10-17T12:00:00Z');
/** A leftover with our marker, named with a lease */
function leftover(kind: 'staging' | 'backup', pid: number, startedAt: number): string {
  const dir = path.join(repo, `.site.${kind}-${pid}-${startedAt}-abcd1234`);
  mkdirSync(dir);
  writeFileSync(path.join(dir, BUILD_MARKER), '');
  writeFileSync(path.join(dir, 'index.html'), `${kind} page`);
  return dir;
}
const alivePids = (...pids: number[]) => (pid: number) => pids.includes(pid);

test('a fresh lease of a live process is a build in progress: its staging and backup are left alone', async () => {
  const staging = leftover('staging', 4242, NOW - 60_000);
  const backup = leftover('backup', 4242, NOW - 60_000);
  rmSync(out, { recursive: true }); // mid-swap: that build has set the old site aside right now
  assert.deepEqual(await recoverInterrupted(out, undefined, NOW, alivePids(4242)), []);
  assert.ok(existsSync(staging) && existsSync(backup));
  assert.ok(!existsSync(out), 'its backup is not "restored" under its feet');
});

test('PID reuse: a live PID with a lease older than the threshold is stale, so its leftovers are cleaned up', async () => {
  const staging = leftover('staging', 4242, NOW - STALE_AFTER_MS - 1);
  const backup = leftover('backup', 4242, NOW - STALE_AFTER_MS - 1);
  const done = await recoverInterrupted(out, undefined, NOW, alivePids(4242));
  assert.equal(done.length, 2);
  assert.ok(!existsSync(staging) && !existsSync(backup));
  assert.equal(readFileSync(path.join(out, 'index.html'), 'utf8'), 'old page', 'the site exists, so the backup is dropped, not restored');
});

test('a dead process\'s fresh lease is stale at once, and a lease from a clock far in the future is too', async () => {
  const dead = leftover('staging', 4243, NOW - 1_000);
  const future = leftover('staging', 4242, NOW + STALE_AFTER_MS + 1);
  await recoverInterrupted(out, undefined, NOW, alivePids(4242));
  assert.ok(!existsSync(dead));
  assert.ok(!existsSync(future));
});

test('rollback after a crash mid-swap: a stale backup is put back as the site when the site is missing', async () => {
  rmSync(out, { recursive: true });
  leftover('backup', 4242, NOW - STALE_AFTER_MS * 2);
  leftover('staging', 4242, NOW - STALE_AFTER_MS * 2);
  const done = await recoverInterrupted(out, undefined, NOW, alivePids(4242));
  assert.equal(readFileSync(path.join(out, 'index.html'), 'utf8'), 'backup page');
  assert.ok(done.some(d => d.startsWith('restored')));
  assert.deepEqual(siblings(), ['site', 'src'], 'the half-written staging directory is removed');
});

test('directories named by older versions (no start time) are judged by their modification time', async () => {
  const oldName = path.join(repo, '.site.staging-4242-abcd1234');
  mkdirSync(oldName);
  writeFileSync(path.join(oldName, BUILD_MARKER), '');
  const fresh = path.join(repo, '.site.staging-4242-beef5678');
  mkdirSync(fresh);
  writeFileSync(path.join(fresh, BUILD_MARKER), '');
  const longAgo = new Date(Date.now() - STALE_AFTER_MS * 3);
  utimesSync(oldName, longAgo, longAgo);
  await recoverInterrupted(out, undefined, Date.now(), alivePids(4242));
  assert.ok(!existsSync(oldName), 'stale by mtime despite a live PID');
  assert.ok(existsSync(fresh), 'recent mtime and a live PID: still in progress');
});

test('a new build names its staging directory with its PID and start time', async () => {
  let name = '';
  const before = Date.now();
  await buildIntoDirectory('site', repo, async dir => { name = path.basename(dir); await writeSite('x')(dir); }, { cwd: repo });
  const m = name.match(/^\.site\.staging-(\d+)-(\d+)-[0-9a-f]{8}$/);
  assert.ok(m, name);
  assert.equal(Number(m![1]), process.pid);
  assert.ok(Number(m![2]) >= before && Number(m![2]) <= Date.now());
});
