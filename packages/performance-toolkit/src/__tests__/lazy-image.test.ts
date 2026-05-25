import { describe, expect, it } from 'vitest';
import { lazyImage } from '../lazy-load/lazy-image.js';

describe('lazyImage', () => {
  it('emits AVIF and WebP sources by default', () => {
    const d = lazyImage({ src: '/hero.jpg', alt: 'Hero' });
    expect(d.sources).toHaveLength(2);
    expect(d.sources[0]!.type).toBe('image/avif');
    expect(d.sources[1]!.type).toBe('image/webp');
  });

  it('uses lazy + async decoding by default (low priority)', () => {
    const d = lazyImage({ src: '/x.jpg', alt: 'X' });
    expect(d.img.loading).toBe('lazy');
    expect(d.img.decoding).toBe('async');
    expect(d.img.fetchPriority).toBeUndefined();
  });

  it('uses eager + fetchPriority=high when priority=high (LCP image)', () => {
    const d = lazyImage({ src: '/hero.jpg', alt: 'Hero', priority: 'high' });
    expect(d.img.loading).toBe('eager');
    expect(d.img.fetchPriority).toBe('high');
  });

  it('builds responsive srcSet with custom widths', () => {
    const d = lazyImage({
      src: '/x.jpg',
      alt: 'X',
      widths: [320, 640, 1280],
    });
    const avif = d.sources[0]!.srcSet;
    expect(avif).toContain('320w');
    expect(avif).toContain('640w');
    expect(avif).toContain('1280w');
    expect(avif).toContain('fmt=avif');
  });

  it('uses ?w= when src has no query string', () => {
    const d = lazyImage({ src: '/x.jpg', alt: 'X', widths: [640] });
    expect(d.sources[0]!.srcSet).toContain('/x.jpg?w=640');
  });

  it('uses &w= when src already has a query string', () => {
    const d = lazyImage({ src: '/x.jpg?v=2', alt: 'X', widths: [640] });
    expect(d.sources[0]!.srcSet).toContain('/x.jpg?v=2&w=640');
  });

  it('attaches LQIP backgroundImage style when provided', () => {
    const d = lazyImage({
      src: '/x.jpg',
      alt: 'X',
      lqip: 'data:image/jpeg;base64,blur',
    });
    expect(d.img.style?.backgroundImage).toBe(
      "url('data:image/jpeg;base64,blur')",
    );
  });

  it('respects custom sizes', () => {
    const d = lazyImage({
      src: '/x.jpg',
      alt: 'X',
      sizes: '(max-width: 640px) 100vw, 50vw',
    });
    expect(d.sources[0]!.sizes).toBe('(max-width: 640px) 100vw, 50vw');
  });

  it('preserves width and height when provided', () => {
    const d = lazyImage({ src: '/x.jpg', alt: 'X', width: 800, height: 600 });
    expect(d.img.width).toBe(800);
    expect(d.img.height).toBe(600);
  });
});
