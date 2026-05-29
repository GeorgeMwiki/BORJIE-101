/**
 * Inline citation embedder — wave ARTIFACT-RICHNESS.
 *
 * Walks the body for `[^cite:<id>]` placeholders, replaces each with a
 * stable superscript anchor (`<sup>(n)</sup>`) and appends a footnotes
 * section that consolidates every distinct citation. The producer
 * supplies the `ArtifactCitation` records; the embedder is purely a
 * shaper — it does not fetch corpus passages.
 *
 * The `[^cite:<id>]` token survives the markdown-to-html escape pass
 * via the same opaque-marker mechanism the mermaid / KaTeX renderers
 * use; the footnotes section is returned as HTML so the html renderer
 * can splice it in just before the audit footer.
 */

import {
  makeMarker,
  makeMarkerId,
  type ArtifactCitation,
  type ArtifactLanguage,
} from './types.js';

const CITATION_RE = /\[\^cite:([a-zA-Z0-9_\-:.]+)\]/g;

export interface CitationsExtractResult {
  readonly body: string;
  readonly htmlOverrides: Readonly<Record<string, string>>;
  readonly footnotesHtml: string | null;
  readonly count: number;
}

const HEADER_SW = 'Marejeo';
const HEADER_EN = 'Evidence';

const NO_CITATIONS_SW =
  'Hapakuwa na vyanzo vilivyotajwa.';
const NO_CITATIONS_EN =
  'No citations were referenced.';

export function embedCitations(
  body: string,
  citations: ReadonlyArray<ArtifactCitation>,
  language: ArtifactLanguage = 'en',
): CitationsExtractResult {
  const htmlOverrides: Record<string, string> = {};
  const referencedOrder: string[] = [];
  let count = 0;

  const byId = new Map<string, ArtifactCitation>();
  for (const c of citations) byId.set(c.id, c);

  const withMarkers = body.replace(CITATION_RE, (_match, id: string) => {
    let order = referencedOrder.indexOf(id);
    if (order === -1) {
      order = referencedOrder.length;
      referencedOrder.push(id);
    }
    const idx = order + 1;
    const markerId = makeMarkerId('citation', count);
    const marker = makeMarker(markerId);
    htmlOverrides[marker] =
      `<sup class="borjie-citation-chip" data-citation-id="${escapeAttr(id)}"><a href="#cite-${escapeAttr(id)}">(${idx})</a></sup>`;
    count += 1;
    return marker;
  });

  const footnotesHtml = renderFootnotes(referencedOrder, byId, language);

  return Object.freeze({
    body: withMarkers,
    htmlOverrides: Object.freeze(htmlOverrides),
    footnotesHtml,
    count,
  });
}

function renderFootnotes(
  orderedIds: ReadonlyArray<string>,
  byId: Map<string, ArtifactCitation>,
  language: ArtifactLanguage,
): string | null {
  if (orderedIds.length === 0) return null;
  const header = language === 'sw' ? HEADER_SW : HEADER_EN;
  const empty = language === 'sw' ? NO_CITATIONS_SW : NO_CITATIONS_EN;
  const items = orderedIds
    .map((id, idx) => {
      const c = byId.get(id);
      if (!c) {
        return `<li id="cite-${escapeAttr(id)}"><span class="borjie-cite-missing">${empty}</span></li>`;
      }
      const label = escapeHtml(c.label);
      const src = escapeHtml(c.source);
      const ev = c.evidenceId ? ` <code>${escapeHtml(c.evidenceId)}</code>` : '';
      const link = c.url
        ? ` <a href="${escapeAttr(c.url)}" rel="noopener noreferrer">${escapeHtml(c.url)}</a>`
        : '';
      const retrieved = c.retrievedAt ? ` <em>${escapeHtml(c.retrievedAt)}</em>` : '';
      return `<li id="cite-${escapeAttr(id)}"><strong>(${idx + 1})</strong> ${label} — ${src}${ev}${link}${retrieved}</li>`;
    })
    .join('\n');
  return `<section class="borjie-footnotes" aria-label="${escapeAttr(header)}">
  <h2>${escapeHtml(header)}</h2>
  <ol>${items}</ol>
</section>`;
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
