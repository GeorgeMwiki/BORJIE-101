/**
 * PDF renderer — Wave UNIVERSAL-DOC-DRAFTER scope 3.
 *
 * Renders the drafter's markdown body into a print-quality PDF using
 * the headless Chromium that already ships with this repo's Playwright
 * dependency. Falls back to a deterministic HTML-bytes payload (with a
 * `text/html` content-type tagged `pdf.html`) when Playwright cannot
 * launch — the drafter route surface stays callable in environments
 * where Chromium is not installed (CI sandboxes / minimal runtime
 * containers) while production gets real PDFs.
 *
 * The bytes layout is `Uint8Array → Buffer` for clean piping through
 * Hono's `c.body(buffer, 200, { 'content-type': 'application/pdf' })`.
 */

import type { BrandContext } from '../brand.js';
import { renderHtml } from './html-renderer.js';

export interface RenderPdfOptions {
  readonly orientation?: 'portrait' | 'landscape';
  readonly format?: 'A4' | 'Letter' | 'Legal';
}

/**
 * Render markdown → PDF buffer. Always returns a Buffer; on the
 * fallback path the bytes are the HTML rendering tagged as `pdf.html`
 * by the caller.
 */
export async function renderPdf(
  body: string,
  ctx: BrandContext,
  options: RenderPdfOptions = {},
): Promise<Buffer> {
  const html = renderHtml(body, ctx);
  try {
    // Dynamic import keeps the cold start path free of Playwright when
    // PDF rendering is never invoked. The module cache means warm calls
    // pay essentially zero cost.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const playwright: any = await import('playwright').catch(() => null);
    if (!playwright || typeof playwright.chromium?.launch !== 'function') {
      return html;
    }
    const browser = await playwright.chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.setContent(html.toString('utf8'), {
        waitUntil: 'networkidle',
      });
      const pdfBytes: Uint8Array = await page.pdf({
        format: options.format ?? 'A4',
        landscape: options.orientation === 'landscape',
        printBackground: true,
        margin: {
          top: '18mm',
          right: '14mm',
          bottom: '18mm',
          left: '14mm',
        },
      });
      await context.close();
      return Buffer.from(pdfBytes);
    } finally {
      await browser.close().catch(() => undefined);
    }
  } catch {
    // Fallback — return the HTML bytes so callers still get something
    // they can serve. The dispatcher labels this `pdf.html` so the FE
    // can branch.
    return html;
  }
}

export const PDF_CONTENT_TYPE = 'application/pdf';
