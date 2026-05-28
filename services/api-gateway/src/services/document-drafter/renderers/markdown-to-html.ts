/**
 * Tiny markdown to HTML converter sufficient for the drafter output.
 *
 * Supports: # headings, ## headings, ### headings, paragraphs, bold,
 * italic, inline code, ordered + unordered lists, horizontal rules,
 * pipe tables, blockquotes. NOT a full CommonMark parser — only what
 * the drafter templates emit.
 *
 * Output is HTML-escaped on the leaves; inline markdown spans are
 * decoded after escaping so we cannot inject script tags.
 */

const escape = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function inlineSpans(s: string): string {
  // bold **text**
  let out = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // italic *text* (avoid matching across already-emitted tags)
  out = out.replace(/(?<!<)\*([^*]+)\*(?!>)/g, '<em>$1</em>');
  // inline code `text`
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  return out;
}

export function markdownToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;

  function isTableRow(line: string): boolean {
    return /^\s*\|.*\|\s*$/.test(line);
  }

  while (i < lines.length) {
    const raw = lines[i] ?? '';
    const line = raw;
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    // headings
    const h3 = /^###\s+(.+)$/.exec(line);
    if (h3) {
      out.push(`<h3>${inlineSpans(escape(h3[1] ?? ''))}</h3>`);
      i += 1;
      continue;
    }
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      out.push(`<h2>${inlineSpans(escape(h2[1] ?? ''))}</h2>`);
      i += 1;
      continue;
    }
    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1) {
      out.push(`<h1>${inlineSpans(escape(h1[1] ?? ''))}</h1>`);
      i += 1;
      continue;
    }
    // hr
    if (/^---+\s*$/.test(line)) {
      out.push('<hr />');
      i += 1;
      continue;
    }
    // blockquote
    if (/^>\s+/.test(line)) {
      out.push(`<blockquote>${inlineSpans(escape(line.replace(/^>\s+/, '')))}</blockquote>`);
      i += 1;
      continue;
    }
    // table
    if (isTableRow(line) && i + 1 < lines.length && /^\s*\|\s*---/.test(lines[i + 1] ?? '')) {
      const headerCells = (line.match(/[^|]+/g) ?? []).map((c) => c.trim());
      const rowLines: string[] = [];
      i += 2; // skip header + separator
      while (i < lines.length && isTableRow(lines[i] ?? '')) {
        rowLines.push(lines[i] ?? '');
        i += 1;
      }
      const headerRow = headerCells.map((c) => `<th>${inlineSpans(escape(c))}</th>`).join('');
      const bodyRows = rowLines
        .map((r) => {
          const cells = (r.match(/[^|]+/g) ?? []).map((c) => c.trim());
          return `<tr>${cells.map((c) => `<td>${inlineSpans(escape(c))}</td>`).join('')}</tr>`;
        })
        .join('');
      out.push(`<table><thead><tr>${headerRow}</tr></thead><tbody>${bodyRows}</tbody></table>`);
      continue;
    }
    // ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i] ?? '')) {
        const m = /^\d+\.\s+(.+)$/.exec(lines[i] ?? '');
        if (m) items.push(`<li>${inlineSpans(escape(m[1] ?? ''))}</li>`);
        i += 1;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }
    // unordered list
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i] ?? '')) {
        const m = /^[-*]\s+(.+)$/.exec(lines[i] ?? '');
        if (m) items.push(`<li>${inlineSpans(escape(m[1] ?? ''))}</li>`);
        i += 1;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    // paragraph: consume until blank line
    const paraLines: string[] = [line];
    i += 1;
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && !/^(#|---|\d+\.|[-*])\s|^\|/.test(lines[i] ?? '')) {
      paraLines.push(lines[i] ?? '');
      i += 1;
    }
    out.push(`<p>${inlineSpans(escape(paraLines.join(' ')))}</p>`);
  }
  return out.join('\n');
}
