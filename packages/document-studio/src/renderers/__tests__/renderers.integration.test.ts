/**
 * GATED integration tests — only run when `LIVE_DOC_RENDERS=true`.
 * Boots against the docker-compose stack at
 * `infra/document-render/docker-compose.yml` and renders a real
 * DOCX (via Carbone), PDF (via Typst), and HTML→PDF (via Puppeteer).
 *
 * Skipped by default so CI doesn't depend on Docker. To run locally:
 *
 *   cd infra/document-render && docker compose up -d --wait
 *   LIVE_DOC_RENDERS=true pnpm --filter @borjie/document-studio test
 *
 * Spec: .audit/litfin-sota-2026-05-23/19-document-generation.md §4–5
 */

import { describe, expect, it } from 'vitest';
import { CarboneRenderer } from '../carbone-renderer.js';
import { TypstRenderer } from '../typst-renderer.js';
import { PdfFromHtmlRenderer } from '../pdf-from-html-renderer.js';

const LIVE = process.env.LIVE_DOC_RENDERS === 'true';
const describeLive = LIVE ? describe : describe.skip;

// Magic bytes — PDF starts with `%PDF`, DOCX/XLSX/PPTX with `PK` (zip).
const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
const ZIP_MAGIC = new Uint8Array([0x50, 0x4b]);

function startsWith(buf: Uint8Array, prefix: Uint8Array): boolean {
  if (buf.byteLength < prefix.byteLength) return false;
  for (let i = 0; i < prefix.byteLength; i++) {
    if (buf[i] !== prefix[i]) return false;
  }
  return true;
}

describeLive('LIVE renderers (LIVE_DOC_RENDERS=true)', () => {
  it('Carbone renders a real DOCX from a bundled template', async () => {
    const renderer = new CarboneRenderer({
      carboneUrl: process.env.CARBONE_URL ?? 'http://localhost:4000',
      timeoutMs: 60_000,
    });
    const out = await renderer.render({
      templateRef: 'monthly-owner-report/template.docx',
      format: 'docx',
      data: {
        owner: { name: 'Jane Doe' },
        period: '2026-04',
        totals: { rent: 487_000, expenses: 92_000 },
      },
    });
    expect(out.error).toBeUndefined();
    expect(startsWith(out.buffer, ZIP_MAGIC)).toBe(true);
    expect(out.buffer.byteLength).toBeGreaterThan(1000);
  });

  it('Carbone renders a PDF via convertTo', async () => {
    const renderer = new CarboneRenderer({
      carboneUrl: process.env.CARBONE_URL ?? 'http://localhost:4000',
      timeoutMs: 60_000,
    });
    const out = await renderer.render({
      templateRef: 'monthly-owner-report/template.docx',
      format: 'pdf',
      data: { owner: { name: 'Jane Doe' }, period: '2026-04' },
    });
    expect(out.error).toBeUndefined();
    expect(startsWith(out.buffer, PDF_MAGIC)).toBe(true);
  });

  it('Typst HTTP server compiles an inline document to PDF', async () => {
    const renderer = new TypstRenderer({
      typstBinary: '',
      typstServerUrl: process.env.TYPST_SERVER_URL ?? 'http://localhost:8001',
      timeoutMs: 60_000,
    });
    const out = await renderer.render({
      // Inline source — the server detects non-`/` prefix and writes
      // a temp file before compiling.
      templateRef: '= Eviction Notice\n\nSample body for live render.',
      format: 'pdf',
      data: { tenant: 'Aisha M' },
    });
    expect(out.error).toBeUndefined();
    expect(startsWith(out.buffer, PDF_MAGIC)).toBe(true);
  });

  it('Puppeteer service renders HTML to PDF', async () => {
    // Use the puppeteerImport seam to hit the network service rather
    // than the in-process puppeteer launch (which would need the
    // peer dep installed locally).
    const url = process.env.PUPPETEER_SERVER_URL ?? 'http://localhost:8002';
    const renderer = new PdfFromHtmlRenderer({
      // Inject a factory that delegates to the HTTP service.
      factory: async () => {
        let body: Uint8Array = new Uint8Array(0);
        return {
          page: {
            setContent: async (html: string) => {
              const r = await fetch(`${url}/render`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ html }),
              });
              if (!r.ok) throw new Error(`puppeteer ${r.status}`);
              body = new Uint8Array(await r.arrayBuffer());
            },
            pdf: async () => body,
            close: async () => undefined,
          },
        };
      },
    });
    const out = await renderer.render({
      templateRef: 'live-html',
      format: 'pdf',
      data: { html: '<h1>Tenant Ledger — 2026-04</h1><p>Live render OK.</p>' },
    });
    expect(out.error).toBeUndefined();
    expect(startsWith(out.buffer, PDF_MAGIC)).toBe(true);
  });
});
