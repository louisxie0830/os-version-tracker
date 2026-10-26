import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineText } from '../src/fetchers/docc.ts';

test('inlineText: text, code and references by title (or identifier), with Apple\'s empty quote pairs dropped', () => {
  assert.equal(inlineText([
    { type: 'text', text: 'Conformance of ' }, { type: 'codeVoice', code: 'X' },
    { type: 'text', text: ' is only available in ‘' }, { type: 'text', text: '’ 27.0 or newer, see ' },
    { type: 'reference', identifier: 'doc://a/b/Charts' }, { type: 'text', text: ' and ' },
    { type: 'reference', identifier: 'doc://a/b/Missing' }, { type: 'emphasis', inlineContent: [{ type: 'text', text: '  now ' }] },
  ], { 'doc://a/b/Charts': { title: 'Swift Charts' } }), 'Conformance of X is only available in 27.0 or newer, see Swift Charts and Missing now');
  assert.equal(inlineText(undefined), '');
});
