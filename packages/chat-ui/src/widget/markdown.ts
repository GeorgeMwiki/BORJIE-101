/**
 * Minimal, dependency-free markdown → safe HTML renderer.
 *
 * Handles the subset Mr. Mwikila actually emits: bold, italic, code,
 * headings, bullet/ordered lists, links, line breaks. Everything else
 * falls back to escaped text. No dangerouslySetInnerHTML consumers should
 * call this with untrusted input without running through escapeHtml first.
 */

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  return out;
}

export function renderMarkdown(input: string): string {
  const lines = input.split('\n');
  const out: string[] = [];
  let inUl = false;
  let inOl = false;

  const closeLists = () => {
    if (inUl) {
      out.push('</ul>');
      inUl = false;
    }
    if (inOl) {
      out.push('</ol>');
      inOl = false;
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) {
      closeLists();
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      closeLists();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (!inUl) {
        closeLists();
        out.push('<ul>');
        inUl = true;
      }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      if (!inOl) {
        closeLists();
        out.push('<ol>');
        inOl = true;
      }
      out.push(`<li>${inline(line.replace(/^\d+\.\s+/, ''))}</li>`);
      continue;
    }
    closeLists();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeLists();
  return out.join('');
}
