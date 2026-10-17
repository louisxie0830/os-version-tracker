import { readFileSync } from 'node:fs';

/** Reads a synthetic test fixture (structure only, written for this project) from test/fixtures */
export function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

/** HTML that looks like a page but has none of the structure the parsers rely on (simulated redesign) */
export const GARBAGE_HTML = `<!doctype html><html><body>
<h1>We've redesigned this page</h1>
<p>Starting soon, things will look different.</p>
<table><tr><th>Name</th><th>Value</th></tr><tr><td>foo</td><td>bar</td></tr></table>
<ul><li>Nothing to see here</li></ul>
</body></html>`;
