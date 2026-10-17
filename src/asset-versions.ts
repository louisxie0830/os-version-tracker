import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Content versions for the page's own assets: each link carries ?v=<hash of the file>, so a new deployment
 * links new URLs and no browser, CDN or server cache can keep serving the old script or stylesheet with the
 * new page. Derived from the files themselves (never a version number kept by hand), so the same content
 * always gets the same version and any change gets a new one.
 */
export const contentVersion = (body: string | Buffer): string => createHash('sha256').update(body).digest('hex').slice(0, 10);

// Works from both src/ (tsx) and dist/ (compiled): public/ sits next to either directory
const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export const SCRIPTS = ['theme.js', 'notifications.js', 'app.js'] as const;
export type Script = (typeof SCRIPTS)[number];

/** Read once at startup, from the same files the static build copies and the server sends */
export const SCRIPT_VERSIONS = Object.fromEntries(SCRIPTS.map(name => [name, contentVersion(readFileSync(path.join(PUBLIC_DIR, name)))])) as Record<Script, string>;

/** The versioned src of one of the page scripts; `up` is the relative path to the site root ("../" on legal pages) */
export const scriptSrc = (name: Script, up = ''): string => `${up}${name}?v=${SCRIPT_VERSIONS[name]}`;
