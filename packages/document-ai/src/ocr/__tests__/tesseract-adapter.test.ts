import { describe, expect, it, vi } from 'vitest';
import { createTesseractAdapter, type TesseractLike } from '../tesseract-adapter.js';

function makeStubTesseract(text: string, withBlocks = false): TesseractLike {
  const blocks = withBlocks
    ? [
        {
          text: 'Header block',
          confidence: 95,
          bbox: { x0: 10, y0: 20, x1: 200, y1: 60 },
        },
        {
          text,
          confidence: 88,
          bbox: { x0: 10, y0: 80, x1: 600, y1: 700 },
        },
      ]
    : undefined;
  return {
    recognize: vi.fn(async () => ({
      data: {
        text,
        confidence: 88,
        ...(blocks ? { blocks } : {}),
      },
    })),
  };
}

describe('createTesseractAdapter', () => {
  it('handles missing peer dep via null loader gracefully', async () => {
    const adapter = createTesseractAdapter({
      loader: async () => null as unknown as TesseractLike,
    });
    const doc = await adapter.recognize({
      bytes: new Uint8Array([1, 2, 3]),
      mime: 'image/png',
      lang: ['en'],
    });
    expect(doc.producedBy).toBe('tesseract-missing');
    expect(doc.pages[0]!.blocks).toHaveLength(0);
  });

  it('parses tesseract single-text response into a single block', async () => {
    const fakeTess = makeStubTesseract('Hello from tesseract');
    const adapter = createTesseractAdapter({ loader: async () => fakeTess });
    const doc = await adapter.recognize({
      bytes: new Uint8Array([1, 2, 3, 4]),
      mime: 'image/png',
      lang: ['en'],
    });
    expect(doc.producedBy).toBe('tesseract');
    expect(doc.pages[0]!.blocks).toHaveLength(1);
    expect(doc.pages[0]!.blocks[0]!.text).toBe('Hello from tesseract');
    expect(doc.pages[0]!.blocks[0]!.confidence).toBeCloseTo(0.88, 2);
  });

  it('parses block-level response with bboxes', async () => {
    const fakeTess = makeStubTesseract('Body content', true);
    const adapter = createTesseractAdapter({
      loader: async () => fakeTess,
      langs: ['sw', 'en'],
    });
    const doc = await adapter.recognize({
      bytes: new Uint8Array([1]),
      mime: 'image/jpeg',
    });
    expect(doc.pages[0]!.blocks).toHaveLength(2);
    expect(doc.pages[0]!.blocks[0]!.bbox.width).toBeGreaterThan(0);
    expect(fakeTess.recognize).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'swa+eng',
      expect.any(Object)
    );
  });
});
