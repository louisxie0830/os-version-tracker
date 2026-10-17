import { existsSync, readdirSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * build-static deletes its output directory before writing, so the target must be provably safe:
 * a dedicated directory that is neither the repository, one of its source folders, nor anything
 * that contains them. A marker file identifies directories created by a previous build, so an
 * existing non-empty directory is only deleted if this tool made it.
 */

export const BUILD_MARKER = '.os-version-tracker-site';

/** Folders inside the repository that must never be (or contain) the output directory */
const PROTECTED = ['.git', '.github', 'src', 'public', 'test', 'node_modules', 'dist', '.state', '.claude'];

export interface OutputDirContext {
  /** Repository root */
  root: string;
  cwd: string;
  home?: string;
  /** Extra parent directories outside the repository where a dedicated output dir is allowed (e.g. the OS temp dir) */
  allowedParents?: string[];
}

export interface ExistingDirInfo {
  exists: boolean;
  isEmpty: boolean;
  hasMarker: boolean;
}

/** Resolves symlinks for the longest existing prefix, so "safe/link-to-src" can't sneak past the checks */
function realResolve(p: string): string {
  const abs = path.resolve(p);
  let current = abs;
  const rest: string[] = [];
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return abs;
    rest.unshift(path.basename(current));
    current = parent;
  }
  return path.join(realpathSync(current), ...rest);
}

const isSameOrInside = (child: string, parent: string) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

const isStrictlyInside = (child: string, parent: string) => child !== parent && isSameOrInside(child, parent);

/**
 * Pure validation: throws with a clear reason when `out` is unsafe to delete and recreate.
 * Paths must already be absolute and symlink-resolved (see resolveOutputDir).
 */
export function validateOutputDir(out: string, ctx: OutputDirContext, existing?: ExistingDirInfo): string {
  const fail = (reason: string): never => {
    throw new Error(`Refusing to use "${out}" as the static output directory: ${reason}. Set OUT_DIR to a dedicated folder such as "site".`);
  };

  if (!path.isAbsolute(out)) fail('path must be absolute');
  if (path.parse(out).root === out) fail('it is the filesystem root');
  if (ctx.home && isSameOrInside(ctx.home, out)) fail('it is (or contains) the home directory');
  if (isSameOrInside(ctx.root, out)) fail('it is (or contains) the repository root');
  if (isSameOrInside(ctx.cwd, out)) fail('it is (or contains) the current working directory');

  for (const name of PROTECTED) {
    const protectedDir = path.join(ctx.root, name);
    if (isSameOrInside(out, protectedDir) || isSameOrInside(protectedDir, out)) fail(`it overlaps the protected "${name}" folder`);
  }

  // Only a dedicated child of the repository, or of an explicitly allowed parent such as the temp dir
  const parents = [ctx.root, ...(ctx.allowedParents ?? [])];
  if (!parents.some(parent => isStrictlyInside(out, parent))) {
    fail(`it must be a sub-folder of the repository${ctx.allowedParents?.length ? ' or the temp directory' : ''}`);
  }
  for (const parent of ctx.allowedParents ?? []) {
    if (out === parent) fail('it is the temp directory itself');
  }

  if (existing?.exists && !existing.isEmpty && !existing.hasMarker) {
    fail(`it already contains files that weren't produced by this build (no ${BUILD_MARKER} marker)`);
  }
  return out;
}

/** Resolves OUT_DIR against the real filesystem and validates it */
export function resolveOutputDir(outDir: string, root: string, cwd = process.cwd()): string {
  const realRoot = realResolve(root);
  const out = realResolve(path.resolve(cwd, outDir));
  let existing: ExistingDirInfo = { exists: false, isEmpty: true, hasMarker: false };
  if (existsSync(out)) {
    const entries = readdirSync(out);
    existing = { exists: true, isEmpty: entries.length === 0, hasMarker: entries.includes(BUILD_MARKER) };
  }
  return validateOutputDir(out, {
    root: realRoot,
    cwd: realResolve(cwd),
    home: realResolve(os.homedir()),
    allowedParents: [realResolve(os.tmpdir())],
  }, existing);
}
