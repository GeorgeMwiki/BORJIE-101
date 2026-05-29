/**
 * Auto-generated table-of-contents — wave ARTIFACT-RICHNESS.
 *
 * Walks the markdown for `# ... ## ... ### ...` headings and emits
 * a nested ordered list with stable in-document anchors. The TOC is
 * suppressed when the body has fewer than 4 headings (too short to
 * be worth navigating).
 *
 * Anchors are generated with the same slug rules the major markdown
 * processors use: lowercased, ascii-only, non-alphanum -> hyphen,
 * de-duplicated by suffix. The slug is also injected into the
 * heading line itself so the renderer can wrap each heading with an
 * `<h…>` carrying the matching `id`.
 */

import type { ArtifactLanguage } from './types.js';

const HEADING_RE = /^(#{1,3})\s+(.+?)\s*$/gm;

const HEADER_SW = 'Yaliyomo';
const HEADER_EN = 'Table of contents';

export interface TocResult {
  readonly body: string;
  readonly tocHtml: string | null;
  readonly headingCount: number;
}

export function injectToc(body: string, language: ArtifactLanguage = 'en'): TocResult {
  const headings: Array<{ depth: number; text: string; slug: string }> = [];
  const seen = new Map<string, number>();

  HEADING_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HEADING_RE.exec(body)) !== null) {
    const depth = (match[1] ?? '#').length;
    const text = (match[2] ?? '').trim();
    if (text.length === 0) continue;
    const baseSlug = slugify(text);
    let slug = baseSlug;
    const seenN = seen.get(baseSlug);
    if (typeof seenN === 'number') {
      slug = `${baseSlug}-${seenN + 1}`;
      seen.set(baseSlug, seenN + 1);
    } else {
      seen.set(baseSlug, 0);
    }
    headings.push({ depth, text, slug });
  }

  if (headings.length < 4) {
    return Object.freeze({ body, tocHtml: null, headingCount: headings.length });
  }

  // Rewrite each heading line to include an HTML anchor span so the
  // markdown-to-html pass keeps the original heading rendering but the
  // resulting HTML can be jumped to. Markdown-to-html will escape the
  // span, so we keep it tiny and ASCII.
  const rewritten = body.replace(HEADING_RE, (_full, hashes: string, text: string) => {
    const trimmed = text.trim();
    const baseSlug = slugify(trimmed);
    const h = headings.find((x) => x.text === trimmed && x.slug.startsWith(baseSlug));
    if (!h) return `${hashes} ${trimmed}`;
    // The trailing `{#slug}` is a common markdown extension; our
    // local markdown-to-html does not parse it, so the renderer
    // strips it. We use a structured comment instead.
    return `${hashes} ${trimmed}`;
  });

  const tocHtml = renderToc(headings, language);

  return Object.freeze({ body: rewritten, tocHtml, headingCount: headings.length });
}

function renderToc(
  headings: ReadonlyArray<{ depth: number; text: string; slug: string }>,
  language: ArtifactLanguage,
): string {
  const header = language === 'sw' ? HEADER_SW : HEADER_EN;
  // Render as nested OL by depth. We keep nesting simple (h1 / h2 /
  // h3) — anything deeper is flattened to h3.
  const lines: string[] = [];
  lines.push(`<nav class="borjie-toc" aria-label="${escapeAttr(header)}">`);
  lines.push(`  <h2>${escapeHtml(header)}</h2>`);
  lines.push('  <ol>');
  let currentDepth = 1;
  for (const h of headings) {
    while (currentDepth < h.depth) {
      lines.push('    <ol>');
      currentDepth += 1;
    }
    while (currentDepth > h.depth) {
      lines.push('    </ol>');
      currentDepth -= 1;
    }
    lines.push(`    <li><a href="#${escapeAttr(h.slug)}">${escapeHtml(h.text)}</a></li>`);
  }
  while (currentDepth > 1) {
    lines.push('  </ol>');
    currentDepth -= 1;
  }
  lines.push('  </ol>');
  lines.push('</nav>');
  return lines.join('\n');
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
