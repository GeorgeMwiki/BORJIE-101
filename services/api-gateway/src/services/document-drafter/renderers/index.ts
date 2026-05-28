/**
 * Multi-format renderer dispatcher.
 *
 * Wave UNIVERSAL-DOC-DRAFTER. Renders a drafter markdown body in the
 * requested format with Borjie brand styling applied uniformly.
 *
 * NOTE: `pdf-renderer.ts` is owned by sibling #125 — when present it is
 * loaded dynamically and used; otherwise the dispatcher falls back to
 * returning the HTML rendering as a `text/html` payload labelled "pdf"
 * (callers can either ignore the content-type and pipe through their
 * own PDF chain, or wait for the sibling commit).
 */

import type { BrandContext } from '../brand.js';
import { renderMarkdown as renderMd } from './md-renderer.js';
import { renderHtml } from './html-renderer.js';
import { renderDocx, DOCX_CONTENT_TYPE } from './docx-renderer.js';
import { renderPptx, PPTX_CONTENT_TYPE } from './pptx-renderer.js';

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
      // Try to load the sibling-owned PDF renderer if it has landed.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod: any = await import('./pdf-renderer.js').catch(() => null);
        if (mod && typeof mod.renderPdf === 'function') {
          const buf: Buffer = mod.renderPdf(body, ctx);
          return { body: buf, contentType: 'application/pdf', extension: 'pdf' };
        }
      } catch {
        // ignore — fall through
      }
      // Fallback: ship the HTML rendering with a PDF-friendly note.
      const html = renderHtml(body, ctx);
      return {
        body: html,
        contentType: 'text/html; charset=utf-8',
        extension: 'pdf.html',
      };
    }
    default: {
      const exhaustive: never = format;
      void exhaustive;
      throw new Error(`renderDraft: unsupported format`);
    }
  }
}
