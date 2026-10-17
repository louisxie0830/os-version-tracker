/**
 * Writes SOURCES.md (the source compliance register) from src/source-registry.ts.
 * Usage: npm run sources:doc
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES, type SourceKey } from './fetch-all.js';
import { sourcesMarkdown } from './source-registry.js';

export function sourceLabels(): Record<SourceKey, string> {
  return Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, v.label])) as Record<SourceKey, string>;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
writeFileSync(path.join(root, 'SOURCES.md'), sourcesMarkdown(sourceLabels()));
console.log('Wrote SOURCES.md');
