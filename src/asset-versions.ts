import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Content versions for the page's own assets: each link carries ?v=<hash of the file>, so a new deployment
 * links new URLs and no browser, CDN or server cache can keep serving the old script or stylesheet with the
 * new page. Derived from the files themselves (never a version number kept by hand), so the same content
 * always gets the same version and any change gets a new one.
 */
export const contentVersion = (body: string | Buffer): string => createHash('sha256').update(body).digest('hex').slice(0, 10);

// Works from both src/ (tsx) and dist/ (compiled): the project root is the parent of either directory
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The PWA assets and the hand-written page scripts */
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
/** Where tsc compiles src/browser/*.ts (the component scripts' only source) */
export const COMPONENT_DIR = path.join(ROOT_DIR, 'dist', 'browser');

/**
 * The custom elements the home page's server-rendered markup is wrapped in (Light DOM, no framework): each
 * adds behaviour to markup that is complete without it. Loaded deferred, before app.js.
 */
export const COMPONENT_SCRIPTS = ['choice-chips.js', 'bank-table.js', 'trend-charts.js'] as const;

/** Every script that pages link, at the site root; the server's static allow-list, the static build and the tests derive from this */
export const SCRIPTS = ['theme.js', 'notifications.js', ...COMPONENT_SCRIPTS, 'app.js'] as const;
export type Script = (typeof SCRIPTS)[number];

export const isScript = (name: string): name is Script => (SCRIPTS as readonly string[]).includes(name);

/**
 * The file behind a script URL: the component scripts as compiled from src/browser/ (so `tsc` must have run),
 * the others from public/. The one place that knows where each script lives; versions, the server and the
 * static build all go through it.
 */
export function scriptPath(name: Script): string {
  return path.join((COMPONENT_SCRIPTS as readonly string[]).includes(name) ? COMPONENT_DIR : PUBLIC_DIR, name);
}

/** A script's content, with a hint when a component script hasn't been compiled yet */
export function readScript(name: Script): Buffer {
  const file = scriptPath(name);
  try {
    return readFileSync(file);
  } catch (err) {
    throw new Error(`${name}: cannot read ${path.relative(ROOT_DIR, file)}${file.startsWith(COMPONENT_DIR) ? ' (run `npm run build` first)' : ''}`, { cause: err });
  }
}

/** Puts the compiled component scripts at the root of a static site (the others come with public/) */
export async function copyComponentScripts(dir: string): Promise<void> {
  for (const name of COMPONENT_SCRIPTS) await copyFile(scriptPath(name), path.join(dir, name));
}

/** Read once at startup, from the same files the static build copies and the server sends */
export const SCRIPT_VERSIONS = Object.fromEntries(SCRIPTS.map(name => [name, contentVersion(readScript(name))])) as Record<Script, string>;

/** The versioned src of one of the page scripts; `up` is the relative path to the site root ("../" on legal pages) */
export const scriptSrc = (name: Script, up = ''): string => `${up}${name}?v=${SCRIPT_VERSIONS[name]}`;
