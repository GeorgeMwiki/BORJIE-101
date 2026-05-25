import { describe, it, expect } from 'vitest';
import { SlideBuilder } from '../index.js';

describe('SlideBuilder', () => {
  it('accumulates slides in order', () => {
    const b = new SlideBuilder();
    b.addTitleSlide({ title: 'T' })
      .addBulletSlide({ title: 'B', bullets: ['a', 'b'] })
      .addSectionDivider({ title: 'S' });
    const slides = b.snapshot();
    expect(slides).toHaveLength(3);
    expect(slides[0]!.kind).toBe('title');
    expect(slides[1]!.kind).toBe('bullet');
    expect(slides[2]!.kind).toBe('section-divider');
  });

  it('supports chart + image slides', () => {
    const b = new SlideBuilder();
    b.addChartSlide({
      title: 'Chart',
      chartSpec: { mark: 'line' },
      chartPng: new Uint8Array([1, 2, 3]),
      caption: 'cap',
    });
    b.addImageSlide({
      title: 'Image',
      imagePng: new Uint8Array([4, 5, 6]),
    });
    expect(b.length).toBe(2);
    expect(b.snapshot()[0]!.kind).toBe('chart');
    expect(b.snapshot()[1]!.kind).toBe('image');
  });

  it('omits optional fields cleanly', () => {
    const b = new SlideBuilder();
    b.addTitleSlide({ title: 'T' });
    const slide = b.snapshot()[0]!;
    expect(slide.kind).toBe('title');
    expect((slide as { subtitle?: string }).subtitle).toBeUndefined();
  });
});
