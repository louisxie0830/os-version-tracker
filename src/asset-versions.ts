import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
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
/** The PWA assets and the hand-written theme.js (loaded in <head>, before the page is drawn) */
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
/** Where tsc compiles src/browser/*.ts (the only source of app.js) */
export const COMPONENT_DIR = path.join(ROOT_DIR, 'dist', 'browser');

/**
 * The scripts compiled from src/browser/ that app.js is made of, in order: the base the components build on
 * (light-element.js), the shared toast stack and link check, then the custom elements the home page's server-rendered
 * markup is wrapped in (Light DOM, no framework: each adds behaviour to markup that is complete without it;
 * choice-chips.js before the controllers that restore choices through it), then page.js, the rest of the
 * page's behaviour. They are classic scripts sharing one global scope (tsc checks them as such), so joining
 * them in this order is the whole build: one request, no bundler.
 */
export const APP_PARTS = [
  'light-element.js', 'toasts.js', 'safe-link.js',
  'choice-chips.js', 'activity-filter.js', 'bank-table.js', 'news-list.js', 'trend-charts.js', 'page-search.js', 'section-nav.js', 'notif-center.js',
  'page.js',
] as const;
export type AppPart = (typeof APP_PARTS)[number];

/** Every script that pages link, at the site root; the server's static allow-list, the static build and the tests derive from this */
export const SCRIPTS = ['theme.js', 'app.js'] as const;
export type Script = (typeof SCRIPTS)[number];

export const isScript = (name: string): name is Script => (SCRIPTS as readonly string[]).includes(name);

/** One compiled part of app.js, with a hint when it hasn't been compiled yet */
export function readPart(name: AppPart): Buffer {
  const file = path.join(COMPONENT_DIR, name);
  try {
    return readFileSync(file);
  } catch (err) {
    throw new Error(`${name}: cannot read ${path.relative(ROOT_DIR, file)} (run \`npm run build\` first)`, { cause: err });
  }
}

/** The parts whose top-level declarations are the globals the others build on: joined as they are */
const SHARED_PARTS: readonly string[] = ['light-element.js', 'toasts.js', 'safe-link.js'];

/**
 * Joins compiled parts into one classic script, each marked with its name. Every part but the shared ones is
 * wrapped in its own try block, so one that throws while loading is reported and the rest still run, as they
 * would as separate scripts.
 */
export function joinAppParts(parts: Array<[name: string, source: string]>): string {
  return parts.map(([name, source]) => SHARED_PARTS.includes(name)
    ? `// ---- ${name} ----\n${source}\n`
    : `// ---- ${name} ----\ntry {\n${source}\n} catch (error) { console.error(${JSON.stringify(name)}, error); }\n`).join('');
}

/**
 * A script's content, the one place that knows where each comes from: theme.js from public/, app.js joined
 * from its compiled parts (so `tsc` must have run). Versions, the server and the static build all go through it.
 */
export function readScript(name: Script): Buffer {
  if (name === 'app.js') return Buffer.from(joinAppParts(APP_PARTS.map(part => [part, readPart(part).toString()])));
  return readFileSync(path.join(PUBLIC_DIR, name));
}

/** Writes app.js at the root of a static site (theme.js comes with public/) */
export async function writeAppScript(dir: string): Promise<void> {
  await writeFile(path.join(dir, 'app.js'), readScript('app.js'));
}

/** Read once at startup, from the same files the static build copies and the server sends */
export const SCRIPT_VERSIONS = Object.fromEntries(SCRIPTS.map(name => [name, contentVersion(readScript(name))])) as Record<Script, string>;

/** The versioned src of one of the page scripts; `up` is the relative path to the site root ("../" on legal pages) */
export const scriptSrc = (name: Script, up = ''): string => `${up}${name}?v=${SCRIPT_VERSIONS[name]}`;
