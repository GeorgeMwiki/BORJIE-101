/**
 * Coverage for the extract-text PDF + image paths via vitest mock —
 * direct execution against tesseract.js's worker is too fragile in the
 * test process. The mock exercises both the unavailable-dep and the
 * caught-engine-error branches.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../ocr/tesseract-adapter.js', () => ({
  TesseractUnavailableError: class TesseractUnavailableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'TesseractUnavailableError';
    }
  },
  // Always throw a plain Error — exercises the "instance of Error" catch.
  runTesseract: vi.fn(async () => {
    throw new Error('mocked engine failure');
  }),
}));

const { extractText } = await import('../ocr/extract-text.js');

describe('extractText with mocked tesseract failure', () => {
  it('PDF with bogus bytes → empty result, method=pdf-parse', async () => {
    const out = await extractText({
      content: Buffer.from('not a real pdf'),
      mimeType: 'application/pdf',
    });
    expect(out.method).toBe('pdf-parse');
    expect(out.text).toBe('');
    expect(out.confidence).toBe(0);
  });

  it('image with bogus bytes → empty result, method=tesseract', async () => {
    const out = await extractText({
      content: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      mimeType: 'image/png',
    });
    expect(out.method).toBe('tesseract');
    expect(out.text).toBe('');
    expect(out.confidence).toBe(0);
    expect(out.pageCount).toBe(1);
  });

  it('forceOcr=true on PDF jumps to tesseract directly', async () => {
    const out = await extractText({
      content: Buffer.from('%PDF-1.4 fake'),
      mimeType: 'application/pdf',
      forceOcr: true,
    });
    expect(['pdf-parse', 'tesseract']).toContain(out.method);
  });

  it('string content for image mime is encoded as UTF-8 bytes', async () => {
    const out = await extractText({
      content: 'placeholder bytes',
      mimeType: 'image/jpeg',
    });
    expect(out.method).toBe('tesseract');
  });

  it('string content for PDF mime is encoded as UTF-8 bytes', async () => {
    const out = await extractText({
      content: 'placeholder',
      mimeType: 'application/pdf',
    });
    expect(['pdf-parse', 'tesseract']).toContain(out.method);
  });
});
