import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, findTable, parseTables } from '../src/fetchers/html-table.ts';

test('cleanText strips tags, decodes the common entities and collapses whitespace', () => {
  assert.equal(cleanText('<b>Xcode&nbsp;26</b>\n  &ndash; macOS&amp;iOS &mdash; <i>Apple&rsquo;s</i> &quot;SDK&quot; it&#39;s'), 'Xcode 26 – macOS&iOS — Apple\'s "SDK" it\'s');
});

test('parseTables: every table, header rows included, with the text before it as context', () => {
  const html = `<h2>Minimum requirements</h2><p>Xcode versions</p>
    <table><thead><tr><th>Xcode</th><th>macOS</th></tr></thead>
      <tbody><tr><td>26.0</td><td>macOS&nbsp;15.6</td></tr><tr></tr><tr><td colspan="2"><a href="#">27.0</a></td></tr></tbody></table>
    <h2>Gradle</h2><table><tr><td>8.13</td></tr></table>`;
  const tables = parseTables(html);
  assert.equal(tables.length, 2);
  assert.deepEqual(tables[0].rows, [['Xcode', 'macOS'], ['26.0', 'macOS 15.6'], ['27.0']], 'empty rows dropped');
  assert.match(tables[0].context, /Minimum requirements Xcode versions$/);
  assert.match(tables[1].context, /Gradle$/);
  assert.equal(findTable(tables, t => /Gradle/.test(t.context))?.rows[0][0], '8.13');
  assert.equal(findTable(tables, t => /Kotlin/.test(t.context)), undefined);
});

test('parseTables: a page without tables gives none', () => {
  assert.deepEqual(parseTables('<p>no tables</p>'), []);
});

test('cleanText: no space left in front of punctuation where a tag ended', () => {
  assert.equal(cleanText('<a>iOS 26</a> , <a>iPadOS 26</a> , and <b>macOS</b> .'), 'iOS 26, iPadOS 26, and macOS.');
  assert.equal(cleanText('<span>A</span> 、 B'), 'A、 B');
});

test('cleanText decodes &amp; last, so an escaped entity stays text', () => {
  assert.equal(cleanText('a &amp;lt;b&amp;gt; &amp;amp; c'), 'a &lt;b&gt; &amp; c');
});
