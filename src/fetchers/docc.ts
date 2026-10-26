/** The inline parts of Apple's DocC JSON (developer.apple.com/tutorials/data/…) that carry text */
export interface InlineNode {
  type?: string;
  text?: string;
  code?: string;
  identifier?: string;
  inlineContent?: InlineNode[];
}

/**
 * Plain text of DocC inline content: text, code voice, and references by their title (or, when the page
 * doesn't include the referenced symbol, the last part of its identifier)
 */
export function inlineText(nodes: InlineNode[] | undefined, refs: Record<string, { title?: string }> = {}): string {
  return joined(nodes, refs).replace(/\s+/g, ' ')
    // Apple's own text sometimes lost a name between quotes ("only available in ‘’ 27.0"): drop the empty pair
    .replace(/‘’ ?|“” ?/g, '')
    .trim();
}

/** The raw text, spaces at the edges of emphasis and links kept ("and<em> now</em>" stays "and now") */
function joined(nodes: InlineNode[] | undefined, refs: Record<string, { title?: string }>): string {
  return (nodes ?? []).map(n =>
    n.type === 'text' ? n.text ?? ''
      : n.type === 'codeVoice' ? n.code ?? ''
        : n.type === 'reference' ? refs[n.identifier ?? '']?.title ?? n.identifier?.split('/').pop() ?? ''
          : joined(n.inlineContent, refs),
  ).join('');
}
