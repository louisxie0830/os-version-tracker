import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BUILD_MARKER, resolveOutputDir, validateOutputDir } from '../src/output-dir.ts';

// Pure validation against a synthetic layout: nothing on disk is touched
const ROOT = '/work/repo';
const ctx = { root: ROOT, cwd: ROOT, home: '/home/me', allowedParents: ['/tmp'] };

test('accepts a dedicated child of the repository or of the temp directory', () => {
  assert.equal(validateOutputDir('/work/repo/site', ctx), '/work/repo/site');
  assert.equal(validateOutputDir('/work/repo/out/site', ctx), '/work/repo/out/site');
  assert.equal(validateOutputDir('/tmp/pages/site', ctx), '/tmp/pages/site');
});

test('rejects the filesystem root, home, repository, its parents and the working directory', () => {
  for (const unsafe of ['/', '/home/me', '/home', '/work/repo', '/work', '/tmp']) {
    assert.throws(() => validateOutputDir(unsafe, ctx), /Refusing/, unsafe);
  }
  assert.throws(() => validateOutputDir('/work/repo/site', { ...ctx, cwd: '/work/repo/site/nested' }), /working directory/);
});

test('rejects protected repository folders and anything inside or around them', () => {
  for (const name of ['.git', '.github', 'src', 'public', 'test', 'node_modules', 'dist', '.state']) {
    assert.throws(() => validateOutputDir(`${ROOT}/${name}`, ctx), /protected/, name);
    assert.throws(() => validateOutputDir(`${ROOT}/${name}/out`, ctx), /protected/, `${name}/out`);
  }
});

test('rejects relative paths and directories outside the allowed parents', () => {
  assert.throws(() => validateOutputDir('site', ctx), /absolute/);
  assert.throws(() => validateOutputDir('/work/other-project/site', ctx), /sub-folder/);
  assert.throws(() => validateOutputDir('/etc/site', ctx), /sub-folder/);
});

test('only replaces an existing non-empty directory that a previous build created', () => {
  const out = '/work/repo/site';
  assert.equal(validateOutputDir(out, ctx, { exists: true, isEmpty: true, hasMarker: false }), out);
  assert.equal(validateOutputDir(out, ctx, { exists: true, isEmpty: false, hasMarker: true }), out);
  assert.throws(() => validateOutputDir(out, ctx, { exists: true, isEmpty: false, hasMarker: false }), new RegExp(BUILD_MARKER.replace('.', '\\.')));
});

test('resolveOutputDir follows symlinks and checks real directories (validation only, nothing deleted)', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'ovt-outdir-'));
  try {
    const repo = path.join(tmp, 'repo');
    mkdirSync(path.join(repo, 'src'), { recursive: true });
    writeFileSync(path.join(repo, 'src', 'keep.ts'), '// must survive');

    // Fresh, missing output dir inside the repo is fine
    assert.match(resolveOutputDir('site', repo, repo), /repo[/\\]site$/);

    // A symlink pointing at src is rejected even though its own name looks harmless
    symlinkSync(path.join(repo, 'src'), path.join(repo, 'innocent'));
    assert.throws(() => resolveOutputDir('innocent', repo, repo), /protected "src"/);

    // An existing folder with someone else's files is refused; with the marker it's accepted
    mkdirSync(path.join(repo, 'docs'));
    writeFileSync(path.join(repo, 'docs', 'notes.md'), 'hand-written');
    assert.throws(() => resolveOutputDir('docs', repo, repo), /marker/);
    writeFileSync(path.join(repo, 'docs', BUILD_MARKER), '');
    assert.match(resolveOutputDir('docs', repo, repo), /docs$/);

    // ".", "..", and the repo itself
    for (const unsafe of ['.', '..', repo]) assert.throws(() => resolveOutputDir(unsafe, repo, repo), /Refusing/, unsafe);
  } finally {
    // Only the temp fixture created above
    rmSync(tmp, { recursive: true, force: true });
  }
});
