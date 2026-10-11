/**
 * Minimal Markdown → HTML for the project's own legal documents (DISCLAIMER*.md), so the web page shows
 * exactly the text kept in the repository. Supports only what those files use: headings, paragraphs,
 * one level of nested lists, tables, horizontal rules, **bold**, `code`, [links](url) and <autolinks>.
 * Everything is HTML-escaped first; links are kept only for http(s) URLs or repository-relative files.
 */

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface MarkdownOptions {
  /** Base URL for relative links such as "DISCLAIMER.en.md" (e.g. the repository's blob URL) */
  relativeBase?: string;
  /** Heading level to use for "#" (deeper headings follow), so the document nests under the page's own h2 */
  headingOffset?: number;
}

function safeHref(raw: string, opts: MarkdownOptions): string | null {
  const url = raw.trim();
  if (/[\s<>"]/.test(url)) return null;
  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
    } catch {
      return null;
    }
  }
  // Repository-relative file such as DISCLAIMER.en.md (no scheme, no traversal)
  if (opts.relativeBase && /^[\w.-]+$/.test(url)) return `${opts.relativeBase.replace(/\/$/, '')}/${url}`;
  return null;
}

function inline(text: string, opts: MarkdownOptions): string {
  // Pull out code spans and links first so their contents aren't touched by the other rules
  const tokens: string[] = [];
  const keep = (html: string) => `\u0000${tokens.push(html) - 1}\u0000`;

  let s = text
    .replace(/`([^`]+)`/g, (_, code) => keep(`<code>${escapeHtml(code)}</code>`))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
      const url = safeHref(href, opts);
      const body = inline(label, opts);
      return keep(url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${body}</a>` : body);
    })
    .replace(/<(https?:\/\/[^>\s]+)>/g, (_, href) => {
      const url = safeHref(href, opts);
      return keep(url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(href)}</a>` : escapeHtml(href));
    });

  s = escapeHtml(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)]);
}

export function markdownToHtml(markdown: string, opts: MarkdownOptions = {}): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  const offset = opts.headingOffset ?? 1;
  let i = 0;

  const isBlockStart = (line: string) => /^(#{1,6}\s|-\s|\s+-\s|\||---\s*$)/.test(line) || line.trim() === '';

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') { i++; continue; }

    if (/^---\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(6, heading[1].length + offset - 1);
      out.push(`<h${level}>${inline(heading[2], opts)}</h${level}>`);
      i++;
      continue;
    }

    if (line.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        if (!cells.every(c => /^:?-{3,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      out.push(`<div class="table-wrap"><table class="compat-table legal-table"><thead><tr>${head.map(c => `<th>${inline(c, opts)}</th>`).join('')}</tr></thead><tbody>${
        body.map(r => `<tr>${r.map(c => `<td>${inline(c, opts)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }

    if (/^-\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && (/^-\s/.test(lines[i]) || /^\s+-\s/.test(lines[i]))) {
        if (/^-\s/.test(lines[i])) {
          items.push(`<li>${inline(lines[i].replace(/^-\s+/, ''), opts)}`);
          i++;
        } else {
          const nested: string[] = [];
          while (i < lines.length && /^\s+-\s/.test(lines[i])) {
            nested.push(`<li>${inline(lines[i].replace(/^\s+-\s+/, ''), opts)}</li>`);
            i++;
          }
          items[items.length - 1] += `<ul>${nested.join('')}</ul>`;
        }
      }
      out.push(`<ul>${items.map(item => `${item}</li>`).join('')}</ul>`);
      continue;
    }

    // Paragraph: consecutive plain lines
    const para: string[] = [];
    while (i < lines.length && !isBlockStart(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    if (!para.length) { para.push(line); i++; }
    out.push(`<p>${inline(para.join(' '), opts)}</p>`);
  }
  return out.join('\n');
}
