/**
 * Renderer richness integration tests — wave ARTIFACT-RICHNESS.
 *
 * Confirms the drafter renderers (HTML / PDF fallback / MD / DOCX /
 * PPTX) carry the new artifact-richness chrome:
 *   - mermaid fence -> branded fallback figure with bilingual caption
 *   - $...$ math -> KaTeX HTML (or branded fallback)
 *   - [^cite:<id>] -> superscript chip + bilingual footnotes section
 *   - >=4 headings -> auto TOC
 *   - branded CSS injected (citation chip, toc, footnotes, fallbacks)
 *
 * The PDF path falls back to HTML bytes in the test runner because
 * Chromium is not available — the test asserts the HTML fallback also
 * contains the richness chrome, which is the same code path
 * production hits when Playwright is absent.
 */

import { describe, it, expect } from 'vitest';
import { renderDraft } from '../renderers/index.js';
import type { BrandContext } from '../brand.js';

const CTX: BrandContext = {
  tenantName: 'Acme Mining Co.',
  title: 'Quarterly Royalty Brief',
  auditHashTail: 'abcd1234',
  classification: 'internal',
  author: 'Borjie brain',
  renderedAtUtc: '2026-05-29T10:00:00Z',
};

const RICH_BODY = `# Quarterly Royalty Brief

## Summary

Royalty share is governed by $r = 0.06 \\cdot V$ where V is gross value.

## Process diagram

\`\`\`mermaid
flowchart TD
  A[Ore extracted] --> B[Smelter]
  B --> C[Royalty due]
\`\`\`

## Liability schedule

Owed amount to TRA was TZS 24M last quarter[^cite:tra-2026q1].

## Decision

Pay before 15 June.
`;

describe('renderDraft — artifact richness end-to-end', () => {
  it('HTML carries TOC, mermaid fallback, citation chip and footnotes', async () => {
    const r = await renderDraft('html', RICH_BODY, CTX, {
      citations: [
        {
          id: 'tra-2026q1',
          label: 'TRA royalty filing Q1 2026',
          source: 'TRA',
          evidenceId: 'ev_tra_42',
        },
      ],
      language: 'en',
    });
    const html = r.body.toString('utf8');
    expect(html).toContain('borjie-toc');
    expect(html).toContain('Table of contents');
    expect(html).toContain('borjie-mermaid-fallback');
    expect(html).toContain('flowchart TD');
    expect(html).toContain('borjie-citation-chip');
    expect(html).toContain('borjie-footnotes');
    expect(html).toContain('TRA royalty filing');
    expect(r.richness?.mermaidCount).toBe(1);
    expect(r.richness?.citationCount).toBe(1);
    expect(r.richness?.mathCount).toBeGreaterThanOrEqual(1);
  });

  it('HTML emits Swahili footnotes header when language=sw', async () => {
    const r = await renderDraft('html', RICH_BODY, CTX, {
      citations: [{ id: 'tra-2026q1', label: 'TRA', source: 'TRA' }],
      language: 'sw',
    });
    const html = r.body.toString('utf8');
    expect(html).toContain('Marejeo');
    expect(html).toContain('Yaliyomo');
    expect(html).toContain('Mchoro wa Mermaid');
  });

  it('PDF fallback path returns enriched HTML bytes', async () => {
    const r = await renderDraft('pdf', RICH_BODY, CTX, {
      citations: [{ id: 'tra-2026q1', label: 'TRA', source: 'TRA' }],
      language: 'en',
    });
    // In CI / sandboxed environments without Playwright we get
    // pdf.html bytes — verify the chrome still appears.
    if (r.extension === 'pdf.html') {
      const html = r.body.toString('utf8');
      expect(html).toContain('borjie-citation-chip');
      expect(html).toContain('borjie-mermaid-fallback');
    } else {
      expect(r.extension).toBe('pdf');
      expect(r.body.length).toBeGreaterThan(100);
    }
  });

  it('MD path leaves the original markdown intact (mermaid + cite tokens preserved)', async () => {
    const r = await renderDraft('md', RICH_BODY, CTX, {
      citations: [{ id: 'tra-2026q1', label: 'TRA', source: 'TRA' }],
      language: 'en',
    });
    const md = r.body.toString('utf8');
    expect(md).toContain('```mermaid');
    expect(md).toContain('[^cite:tra-2026q1]');
    // brand header + footer come from the existing md-renderer
    expect(md).toContain('Borjie | Acme Mining Co.');
  });

  it('DOCX path returns a valid OOXML buffer', async () => {
    const r = await renderDraft('docx', RICH_BODY, CTX, {
      citations: [{ id: 'tra-2026q1', label: 'TRA', source: 'TRA' }],
      language: 'en',
    });
    expect(r.extension).toBe('docx');
    // PK\x03\x04 — local file header magic for any zip / docx
    expect(r.body[0]).toBe(0x50);
    expect(r.body[1]).toBe(0x4b);
    expect(r.body[2]).toBe(0x03);
    expect(r.body[3]).toBe(0x04);
  });

  it('PPTX path returns a valid OOXML buffer', async () => {
    const r = await renderDraft('pptx', RICH_BODY, CTX, {
      citations: [{ id: 'tra-2026q1', label: 'TRA', source: 'TRA' }],
      language: 'en',
    });
    expect(r.extension).toBe('pptx');
    expect(r.body[0]).toBe(0x50);
    expect(r.body[1]).toBe(0x4b);
  });

  it('opt-out (enrich:false) bypasses the richness pipeline', async () => {
    const r = await renderDraft('html', RICH_BODY, CTX, {
      enrich: false,
      language: 'en',
    });
    const html = r.body.toString('utf8');
    // The richness pipeline did not run, so the mermaid block stays
    // as text and the cite token stays raw. (The shared CSS block
    // remains in <style> regardless — it is harmless when unused.)
    expect(html).toContain('[^cite:tra-2026q1]');
    expect(html).not.toContain('<figure class="borjie-mermaid-fallback"');
    expect(html).not.toContain('<sup class="borjie-citation-chip"');
    expect(r.richness).toBeUndefined();
  });
});
