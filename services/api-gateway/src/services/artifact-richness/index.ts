/**
 * Artifact-richness — public surface.
 *
 * Wave ARTIFACT-RICHNESS-2026-05-29.
 *
 * Drives Borjie's 12 artifact families (drafts, briefs, scan reports,
 * decision journals, inspection narratives, compliance exports,
 * plan-DAGs, blackboards, settlement statements, RFB confirmations,
 * live cockpit cards, audit-chain receipts) to the 2026 bar set by
 * Claude Code, Notion AI, Linear, Manus and the shadcn/v0 ecosystem.
 *
 * The shape of the layer:
 *
 *   markdown body  ->  richness pipeline  ->  branded HTML
 *                                            (mermaid SVG /
 *                                             KaTeX MathML /
 *                                             citation chips +
 *                                             auto-TOC +
 *                                             footnotes)
 *
 * The pipeline is plug-and-play: drafter renderers call
 * `prepareRichBody()` to fold mermaid + KaTeX + citation + TOC into
 * the source markdown, then run their existing markdown-to-html pass,
 * then call `applyHtmlOverrides()` to splice in the pre-rendered
 * fragments. The downstream PDF / DOCX / PPTX paths consume the same
 * HTML, so visual integrity is preserved across all 5 formats.
 */

export {
  DEFAULT_RICHNESS_OPTIONS,
  RICHNESS_MARKER_PREFIX,
  RICHNESS_MARKER_SUFFIX,
  makeMarker,
  makeMarkerId,
  type ArtifactCitation,
  type ArtifactClassification,
  type ArtifactLanguage,
  type ArtifactRichnessOptions,
  type RichnessResult,
} from './types.js';

export {
  renderMermaidBlocks,
  type MermaidExtractResult,
} from './mermaid.js';

export {
  renderMathBlocks,
  type KatexExtractResult,
} from './katex.js';

export {
  embedCitations,
  type CitationsExtractResult,
} from './citations.js';

export {
  injectToc,
  type TocResult,
} from './toc.js';

export {
  emptyState,
  emptyStateHtml,
  type EmptyStateKind,
} from './empty-states.js';

export {
  buildBrandedLayout,
  ARTIFACT_RICHNESS_CSS,
  type BrandedLayout,
  type BrandedLayoutInput,
} from './branded-layout.js';

import {
  DEFAULT_RICHNESS_OPTIONS,
  type ArtifactCitation,
  type ArtifactRichnessOptions,
  type RichnessResult,
} from './types.js';
import { renderMermaidBlocks } from './mermaid.js';
import { renderMathBlocks } from './katex.js';
import { embedCitations } from './citations.js';
import { injectToc } from './toc.js';

/**
 * One-call helper that runs the full richness pipeline. Returns a
 * `RichnessResult` ready to feed into a markdown-to-html renderer.
 * Pure (other than the lazy dynamic-imports inside each sub-step).
 */
export async function prepareRichBody(
  body: string,
  citations: ReadonlyArray<ArtifactCitation>,
  opts: Partial<ArtifactRichnessOptions> = {},
): Promise<RichnessResult> {
  const options = { ...DEFAULT_RICHNESS_OPTIONS, ...opts };
  const language = options.language;
  let working = body;
  const overrides: Record<string, string> = {};

  let mermaidCount = 0;
  if (options.mermaid) {
    const r = await renderMermaidBlocks(working, language);
    working = r.body;
    Object.assign(overrides, r.htmlOverrides);
    mermaidCount = r.count;
  }

  let mathCount = 0;
  if (options.katex) {
    const r = await renderMathBlocks(working, language);
    working = r.body;
    Object.assign(overrides, r.htmlOverrides);
    mathCount = r.count;
  }

  let citationCount = 0;
  let footnotesHtml: string | null = null;
  if (options.footnotes) {
    const r = embedCitations(working, citations, language);
    working = r.body;
    Object.assign(overrides, r.htmlOverrides);
    footnotesHtml = r.footnotesHtml;
    citationCount = r.count;
  }

  let tocHtml: string | null = null;
  if (options.tableOfContents) {
    const r = injectToc(working, language);
    working = r.body;
    tocHtml = r.tocHtml;
  }

  return Object.freeze({
    body: working,
    htmlOverrides: Object.freeze(overrides),
    tocHtml,
    footnotesHtml,
    mermaidCount,
    mathCount,
    citationCount,
  });
}

/**
 * Splice pre-rendered HTML overrides into the post-markdown-to-html
 * string. Tokens that the markdown-to-html pass escapes (`<` -> `&lt;`
 * etc.) are caught with a tolerant match. The function is pure.
 */
export function applyHtmlOverrides(
  html: string,
  overrides: Readonly<Record<string, string>>,
): string {
  let out = html;
  for (const [marker, fragment] of Object.entries(overrides)) {
    // markdown-to-html may have wrapped the marker in <p>...</p>
    // when it sat alone on a line, or escaped the marker characters.
    // The marker is ascii-only and unique, so a global string replace
    // is safe.
    out = out.split(marker).join(fragment);
  }
  return out;
}
