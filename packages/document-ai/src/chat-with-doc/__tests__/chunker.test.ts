import { describe, expect, it } from 'vitest';
import { chunkDocument } from '../chunker.js';
import { buildPage, buildParsedDocument } from '../../ocr/parsed-document-builder.js';
import { leaseAgreementPage } from '../../ocr/__tests__/fixtures.js';

describe('chunkDocument', () => {
  it('produces at least one chunk per page', async () => {
    const doc = await buildParsedDocument({
      sourceMime: 'application/pdf',
      sourceBytes: new Uint8Array([1]),
      pages: [leaseAgreementPage()],
      producedBy: 'test',
    });
    const chunks = chunkDocument(doc, { maxChars: 5000 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]!.docId).toBe(doc.id);
    expect(chunks[0]!.pageNumber).toBe(1);
  });

  it('starts a new chunk on a heading', async () => {
    const doc = await buildParsedDocument({
      sourceMime: 'application/pdf',
      sourceBytes: new Uint8Array([1]),
      pages: [
        buildPage({
          pageNumber: 1,
          language: 'en',
          blocks: [
            {
              id: 'b-0',
              text: 'First paragraph body content.',
              bbox: { x: 0, y: 0, width: 1, height: 0.1 },
              role: 'paragraph',
              confidence: 1,
              language: 'en',
            },
            {
              id: 'b-1',
              text: 'SECTION HEADING',
              bbox: { x: 0, y: 0.1, width: 1, height: 0.05 },
              role: 'heading',
              confidence: 1,
              language: 'en',
            },
            {
              id: 'b-2',
              text: 'Second paragraph after heading.',
              bbox: { x: 0, y: 0.15, width: 1, height: 0.1 },
              role: 'paragraph',
              confidence: 1,
              language: 'en',
            },
          ],
        }),
      ],
      producedBy: 'test',
    });
    const chunks = chunkDocument(doc, { maxChars: 10000 });
    expect(chunks.length).toBe(2);
    expect(chunks[1]!.text).toContain('SECTION HEADING');
  });

  it('respects maxChars by splitting long content', async () => {
    const longBlock = 'a'.repeat(800);
    const doc = await buildParsedDocument({
      sourceMime: 'application/pdf',
      sourceBytes: new Uint8Array([1]),
      pages: [
        buildPage({
          pageNumber: 1,
          language: 'en',
          blocks: [
            {
              id: 'b-0',
              text: longBlock,
              bbox: { x: 0, y: 0, width: 1, height: 0.1 },
              role: 'paragraph',
              confidence: 1,
              language: 'en',
            },
            {
              id: 'b-1',
              text: longBlock,
              bbox: { x: 0, y: 0.1, width: 1, height: 0.1 },
              role: 'paragraph',
              confidence: 1,
              language: 'en',
            },
          ],
        }),
      ],
      producedBy: 'test',
    });
    const chunks = chunkDocument(doc, { maxChars: 1000 });
    expect(chunks.length).toBe(2);
  });
});
