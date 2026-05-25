import { describe, expect, it } from 'vitest';
import { createMockOCRAdapter } from '../mock-adapter.js';
import { leaseAgreementPage } from './fixtures.js';

describe('createMockOCRAdapter', () => {
  it('returns ParsedDocument with the fixture pages and stable sha256', async () => {
    const adapter = createMockOCRAdapter({
      fixture: { id: 'fix-1', pages: [leaseAgreementPage()] },
    });
    const bytes = new TextEncoder().encode('original-pdf-bytes');
    const doc = await adapter.recognize({ bytes, mime: 'application/pdf', lang: ['en'] });

    expect(doc.id).toBe('fix-1');
    expect(doc.producedBy).toBe('mock-ocr');
    expect(doc.sourceMime).toBe('application/pdf');
    expect(doc.sourceSha256).toMatch(/^[0-9a-f]+$/);
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0]!.blocks).toHaveLength(5);
    expect(doc.pages[0]!.language).toBe('en');
    expect(doc.dominantLanguage).toBe('en');
  });

  it('respects maxPages', async () => {
    const adapter = createMockOCRAdapter({
      fixture: { pages: [leaseAgreementPage(), leaseAgreementPage()] },
    });
    const bytes = new Uint8Array([1, 2, 3]);
    const doc = await adapter.recognize({
      bytes,
      mime: 'application/pdf',
      maxPages: 1,
    });
    expect(doc.pages).toHaveLength(1);
  });

  it('preserves layout bounding boxes', async () => {
    const adapter = createMockOCRAdapter({ fixture: { pages: [leaseAgreementPage()] } });
    const doc = await adapter.recognize({ bytes: new Uint8Array(8), mime: 'application/pdf' });
    const heading = doc.pages[0]!.blocks[0]!;
    expect(heading.role).toBe('heading');
    expect(heading.bbox.x).toBeGreaterThan(0);
    expect(heading.bbox.width).toBeLessThanOrEqual(1);
  });

  it('joins per-page text with form-feed in the doc text', async () => {
    const adapter = createMockOCRAdapter({
      fixture: { pages: [leaseAgreementPage(), leaseAgreementPage()] },
    });
    const doc = await adapter.recognize({ bytes: new Uint8Array(4), mime: 'application/pdf' });
    expect(doc.text).toContain('\f');
  });
});
