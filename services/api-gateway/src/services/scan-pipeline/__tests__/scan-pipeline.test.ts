/**
 * R19 — deskew + pdf-assembler pure-function tests.
 */

import { describe, expect, it } from 'vitest';
import {
  computeDeskewAngle,
  decideDeskewForPages,
  type QuadCorners,
} from '../deskew';
import { assemblePdf, type AssemblerPage } from '../pdf-assembler';

describe('computeDeskewAngle', () => {
  it('returns null for a missing quad', () => {
    expect(computeDeskewAngle(null)).toBeNull();
    expect(computeDeskewAngle(undefined)).toBeNull();
  });

  it('returns null for a horizontal quad below threshold', () => {
    const quad: QuadCorners = {
      tl: { x: 0, y: 0 },
      tr: { x: 1000, y: 1 },
      br: { x: 1000, y: 1000 },
      bl: { x: 0, y: 1000 },
    };
    // 0.057° < 0.5° threshold → null.
    expect(computeDeskewAngle(quad)).toBeNull();
  });

  it('computes a positive angle for a clockwise-tilted scan', () => {
    const quad: QuadCorners = {
      tl: { x: 0, y: 0 },
      tr: { x: 1000, y: 100 }, // 5.71° tilt down-right
      br: { x: 900, y: 1100 },
      bl: { x: -100, y: 1000 },
    };
    const angle = computeDeskewAngle(quad);
    expect(angle).not.toBeNull();
    // Camera Y increases downward; positive raw angle means we need
    // to rotate counter-clockwise to flatten → returned value < 0.
    expect((angle ?? 0)).toBeLessThan(0);
    expect(Math.abs((angle ?? 0))).toBeGreaterThan(5);
  });

  it('honours custom minDegrees threshold', () => {
    const quad: QuadCorners = {
      tl: { x: 0, y: 0 },
      tr: { x: 1000, y: 18 },
      br: { x: 1000, y: 1000 },
      bl: { x: 0, y: 1000 },
    };
    // ~1.03° tilt — below 2° threshold.
    expect(computeDeskewAngle(quad, 2)).toBeNull();
    // …but above 0.5° default.
    expect(computeDeskewAngle(quad, 0.5)).not.toBeNull();
  });
});

describe('decideDeskewForPages', () => {
  it('marks pages with no quad as skipped', () => {
    const result = decideDeskewForPages([
      { pageNumber: 1, quad: null },
      { pageNumber: 2 },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]?.skipped).toBe(true);
    expect(result[1]?.skipped).toBe(true);
  });

  it('emits angle + skipped=false for a tilted page', () => {
    const result = decideDeskewForPages([
      {
        pageNumber: 1,
        quad: {
          tl: { x: 0, y: 0 },
          tr: { x: 1000, y: 50 },
          br: { x: 1000, y: 1000 },
          bl: { x: 0, y: 1000 },
        },
      },
    ]);
    expect(result[0]?.skipped).toBe(false);
    expect(result[0]?.angleDeg).not.toBeNull();
  });
});

describe('assemblePdf', () => {
  it('throws when no pages given', () => {
    expect(() => assemblePdf([])).toThrow(/at least one page/);
  });

  it('returns a PDF byte stream with the %PDF-1.4 header', () => {
    const dummyJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const page: AssemblerPage = {
      pageNumber: 1,
      imageBytes: dummyJpeg,
      mimeType: 'image/jpeg',
      widthPx: 612,
      heightPx: 792,
    };
    const result = assemblePdf([page]);
    expect(result.pageCount).toBe(1);
    expect(result.bytes.length).toBeGreaterThan(dummyJpeg.length);
    const decoder = new TextDecoder();
    const head = decoder.decode(result.bytes.slice(0, 8));
    expect(head).toBe('%PDF-1.4');
    const tail = decoder.decode(result.bytes.slice(result.bytes.length - 6));
    expect(tail).toContain('%%EOF');
  });

  it('embeds multiple pages with the correct Count', () => {
    const dummy = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const pages: AssemblerPage[] = [
      {
        pageNumber: 1,
        imageBytes: dummy,
        mimeType: 'image/jpeg',
        widthPx: 612,
        heightPx: 792,
      },
      {
        pageNumber: 2,
        imageBytes: dummy,
        mimeType: 'image/jpeg',
        widthPx: 612,
        heightPx: 792,
      },
    ];
    const result = assemblePdf(pages);
    expect(result.pageCount).toBe(2);
    const decoded = new TextDecoder().decode(result.bytes);
    expect(decoded).toContain('/Count 2');
    expect(decoded).toContain('/Type /Pages');
  });
});
