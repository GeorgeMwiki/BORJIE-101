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

export type RenderFormat = 'md' | 'pdf' | 'docx' | 'pptx' | 'html';

export interface RenderResult {
  readonly body: Buffer;
  readonly contentType: string;
  readonly extension: string;
}

export async function renderDraft(
  format: RenderFormat,
  body: string,
  ctx: BrandContext,
): Promise<RenderResult> {
  switch (format) {
    case 'md':
      return {
        body: Buffer.from(renderMd(body, ctx), 'utf8'),
        contentType: 'text/markdown; charset=utf-8',
        extension: 'md',
      };
    case 'html':
      return {
        body: renderHtml(body, ctx),
        contentType: 'text/html; charset=utf-8',
        extension: 'html',
      };
    case 'docx':
      return {
        body: renderDocx(body, ctx),
        contentType: DOCX_CONTENT_TYPE,
        extension: 'docx',
      };
    case 'pptx':
      return {
        body: renderPptx(body, ctx),
        contentType: PPTX_CONTENT_TYPE,
        extension: 'pptx',
      };
    case 'pdf': {
      const pdf = await renderPdf(body, ctx);
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
      };
    }
    default: {
      const exhaustive: never = format;
      void exhaustive;
      throw new Error(`renderDraft: unsupported format`);
    }
  }
}
