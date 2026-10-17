import { esc } from './render-actions.js';
import { CONTENT_SECURITY_POLICY } from './security-headers.js';
import { REPO_BLOB } from './source-registry.js';
import { STYLE_VERSION } from './render-styles.js';
import { scriptSrc } from './asset-versions.js';

/**
 * The legal documents (DISCLAIMER.md, DISCLAIMER.en.md, SOURCES.md) published on the site itself under
 * /legal/, so readers don't have to leave for GitHub. A small Markdown converter covers exactly what those
 * files use: headings, paragraphs, nested lists, tables, bold, inline code, links and HTML comments.
 */

export interface LegalPage {
  /** Published path under the site root, e.g. "legal/en/index.html" */
  path: string;
  /** Source file in the repository */
  source: string;
  title: string;
  lang: string;
}

export const LEGAL_PAGES: LegalPage[] = [
  { path: 'legal/index.html', source: 'DISCLAIMER.md', title: '免責聲明與智慧財產權聲明', lang: 'zh-Hant' },
  { path: 'legal/en/index.html', source: 'DISCLAIMER.en.md', title: 'Disclaimer and Intellectual Property Notice', lang: 'en' },
  { path: 'legal/sources/index.html', source: 'SOURCES.md', title: '資料來源合規清冊', lang: 'zh-Hant' },
];

/** Where a link between the documents points once published; other repository files go to GitHub */
function linkTarget(href: string, fromPath: string): string {
  if (/^(?:https?:|mailto:|#)/.test(href)) return href;
  const depth = fromPath.split('/').length - 1;
  const up = '../'.repeat(depth);
  const page = LEGAL_PAGES.find(p => p.source === href.replace(/^\.\//, '').split('#')[0]);
  if (page) return `${up}${page.path.replace(/index\.html$/, '')}${href.includes('#') ? href.slice(href.indexOf('#')) : ''}`;
  return `${REPO_BLOB}/${href.replace(/^\.\//, '')}`;
}

function inline(text: string, fromPath: string): string {
  // Code spans first, so their contents aren't formatted
  const parts = text.split(/(`[^`]+`)/);
  return parts.map(part => {
    if (/^`[^`]+`$/.test(part)) return `<code>${esc(part.slice(1, -1))}</code>`;
    let s = esc(part);
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `<a href="${esc(linkTarget(href.replace(/&amp;/g, '&'), fromPath))}">${label}</a>`);
    s = s.replace(/&lt;(https?:\/\/[^\s&]+(?:&amp;[^\s&]+)*)&gt;/g, (_, url) => `<a href="${url}">${url}</a>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return s;
  }).join('');
}

const slug = (text: string) => text.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');

export function markdownToHtml(md: string, fromPath = 'legal/index.html'): string {
  const lines = md.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const html = inline(h[2], fromPath);
      out.push(`<h${level} id="${slug(html)}">${html}</h${level}>`);
      i++;
      continue;
    }
    if (isTableRow(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<div class="table-wrap"><table class="compat-table"><thead><tr>${head.map(c => `<th>${inline(c, fromPath)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c, fromPath)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      // A list, with items indented by two spaces nested one level
      const items: Array<{ depth: number; text: string }> = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)[-*]\s+(.*)$/)!;
        items.push({ depth: Math.floor(m[1].length / 2), text: m[2] });
        i++;
      }
      let html = '<ul>';
      let depth = 0;
      items.forEach((item, k) => {
        while (item.depth > depth) { html = html.replace(/<\/li>$/, ''); html += '<ul>'; depth++; }
        while (item.depth < depth) { html += '</ul></li>'; depth--; }
        html += `<li>${inline(item.text, fromPath)}</li>`;
        if (k === items.length - 1) while (depth > 0) { html += '</ul></li>'; depth--; }
      });
      out.push(`${html}</ul>`);
      continue;
    }
    // A paragraph runs until a blank line or another block
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4})\s|^\s*[-*]\s+/.test(lines[i]) && !isTableRow(lines[i])) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(' '), fromPath)}</p>`);
  }
  return out.join('\n');
}

/** A complete page with the site's stylesheet and CSP; robots stay out like the rest of the site */
export function renderLegalPage(page: LegalPage, markdown: string): string {
  const up = '../'.repeat(page.path.split('/').length - 1);
  const nav = LEGAL_PAGES.map(p => `<a href="${up}${p.path.replace(/index\.html$/, '')}"${p === page ? ' aria-current="page"' : ''}>${esc(p.title)}</a>`).join(' · ');
  return `<!DOCTYPE html>
<html lang="${page.lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai">
  <title>${esc(page.title)}｜OS Version Tracker</title>
  <script src="${scriptSrc('theme.js', up)}"></script>
  <link rel="icon" href="${up}icons/icon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="${up}style.css?v=${STYLE_VERSION}">
</head>
<body>
  <main class="legal-doc" id="main">
    <p class="legal-doc-nav"><a href="${up}">← OS Version Tracker</a> · ${nav}</p>
    <article class="panel">
${markdownToHtml(markdown, page.path)}
    </article>
    <p class="table-note">原始檔：${`<a href="${REPO_BLOB}/${page.source}">${esc(page.source)}</a>`}</p>
  </main>
</body>
</html>`;
}
