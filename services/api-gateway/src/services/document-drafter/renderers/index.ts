/**
 * Multi-format renderer dispatcher.
 *
 * Wave UNIVERSAL-DOC-DRAFTER. Renders a drafter markdown body in the
 * requested format with Borjie brand styling applied uniformly.
 *
 * PDF rendering is wired through `./pdf-renderer.ts` and uses the
 * headless Chromium that ships with Playwright. The renderer degrades
 * to an HTML-bytes payload labelled `pdf.html` when Playwright cannot
 * launch (CI sandboxes / minimal containers).
 */

import type { BrandContext } from '../brand.js';
import { renderMarkdown as renderMd } from './md-renderer.js';
import { renderHtml } from './html-renderer.js';
import { renderDocx, DOCX_CONTENT_TYPE } from './docx-renderer.js';
import { renderPptx, PPTX_CONTENT_TYPE } from './pptx-renderer.js';
import { renderPdf, PDF_CONTENT_TYPE } from './pdf-renderer.js';
import {
  prepareRichBody,
  type ArtifactCitation,
  type ArtifactLanguage,
  type RichnessResult,
} from '../../artifact-richness/index.js';

export type RenderFormat = 'md' | 'pdf' | 'docx' | 'pptx' | 'html';

export interface RenderResult {
  readonly body: Buffer;
  readonly contentType: string;
  readonly extension: string;
  /** Counters for downstream observability (audit + cockpit-events). */
  readonly richness?: {
    readonly mermaidCount: number;
    readonly mathCount: number;
    readonly citationCount: number;
  };
}

export interface RenderRichOptions {
  /** Optional citations to embed via the richness pipeline. */
  readonly citations?: ReadonlyArray<ArtifactCitation>;
  /** Language used by empty-state copy + footnote header. */
  readonly language?: ArtifactLanguage;
  /** When true (default), enrich the body through the richness
   * pipeline (mermaid + KaTeX + citations + TOC) before format-
   * specific rendering. When false, behave like the pre-richness
   * path so callers can opt out. */
  readonly enrich?: boolean;
}

export async function renderDraft(
  format: RenderFormat,
  body: string,
  ctx: BrandContext,
  opts: RenderRichOptions = {},
): Promise<RenderResult> {
  const enrich = opts.enrich !== false;
  let richness: RichnessResult | undefined;
  let enrichedBody = body;
  if (enrich) {
    richness = await prepareRichBody(body, opts.citations ?? [], {
      language: opts.language ?? 'en',
    });
    enrichedBody = richness.body;
  }
  const counters = richness
    ? {
        mermaidCount: richness.mermaidCount,
        mathCount: richness.mathCount,
        citationCount: richness.citationCount,
      }
    : undefined;

  switch (format) {
    case 'md':
      return {
        body: Buffer.from(renderMd(body, ctx), 'utf8'),
        contentType: 'text/markdown; charset=utf-8',
        extension: 'md',
        ...(counters ? { richness: counters } : {}),
      };
    case 'html':
      return {
        body: renderHtml(enrichedBody, ctx, richness ? { richness } : {}),
        contentType: 'text/html; charset=utf-8',
        extension: 'html',
        ...(counters ? { richness: counters } : {}),
      };
    case 'docx':
      return {
        body: renderDocx(body, ctx),
        contentType: DOCX_CONTENT_TYPE,
        extension: 'docx',
        ...(counters ? { richness: counters } : {}),
      };
    case 'pptx':
      return {
        body: renderPptx(body, ctx),
        contentType: PPTX_CONTENT_TYPE,
        extension: 'pptx',
        ...(counters ? { richness: counters } : {}),
      };
    case 'pdf': {
      const pdf = await renderPdf(enrichedBody, ctx, {}, richness ? { richness } : {});
      // When the headless Chromium launch fails we get an HTML
      // payload back instead — content sniff the first bytes to keep
      // the response honest. A real PDF starts with `%PDF-`.
      const isRealPdf =
        pdf.length >= 5 &&
        pdf[0] === 0x25 && // %
        pdf[1] === 0x50 && // P
        pdf[2] === 0x44 && // D
        pdf[3] === 0x46 && // F
        pdf[4] === 0x2d; // -
      return {
        body: pdf,
        contentType: isRealPdf ? PDF_CONTENT_TYPE : 'text/html; charset=utf-8',
        extension: isRealPdf ? 'pdf' : 'pdf.html',
        ...(counters ? { richness: counters } : {}),
      };
    }
    default: {
      const exhaustive: never = format;
      void exhaustive;
      throw new Error(`renderDraft: unsupported format`);
    }
  }
}
