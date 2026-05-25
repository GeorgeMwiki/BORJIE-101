import { describe, expect, it } from 'vitest';
import {
  BUTTON_VARIANTS,
  DRAWER_VARIANTS,
  TABLE_VARIANTS,
} from '../shadcn-variants.js';

describe('shadcn-variants: BUTTON_VARIANTS', () => {
  it('exposes all required intents', () => {
    const intents = Object.keys(BUTTON_VARIANTS.intent);
    for (const i of ['primary', 'secondary', 'destructive', 'ghost', 'link']) {
      expect(intents).toContain(i);
    }
  });

  it('exposes all sizes', () => {
    const sizes = Object.keys(BUTTON_VARIANTS.size);
    for (const s of ['sm', 'md', 'lg', 'icon']) expect(sizes).toContain(s);
  });

  it('loading state has spinner + hide-label classes', () => {
    expect(BUTTON_VARIANTS.loading.spinner).toContain('animate-spin');
    expect(BUTTON_VARIANTS.loading.hideLabel).toContain('opacity-0');
  });

  it('base includes focus-visible ring for keyboard a11y', () => {
    expect(BUTTON_VARIANTS.base).toContain('focus-visible:ring');
  });
});

describe('shadcn-variants: TABLE_VARIANTS', () => {
  it('virtual scroll has sensible defaults', () => {
    expect(TABLE_VARIANTS.virtual.rowHeight).toBeGreaterThan(0);
    expect(TABLE_VARIANTS.virtual.overscan).toBeGreaterThanOrEqual(0);
  });

  it('all density modes exist', () => {
    const d = Object.keys(TABLE_VARIANTS.density);
    expect(d).toEqual(expect.arrayContaining(['compact', 'comfortable', 'spacious']));
  });
});

describe('shadcn-variants: DRAWER_VARIANTS', () => {
  it('all 4 sides defined', () => {
    expect(Object.keys(DRAWER_VARIANTS.side)).toEqual(
      expect.arrayContaining(['left', 'right', 'top', 'bottom']),
    );
  });

  it('resize handle bounds are sensible', () => {
    expect(DRAWER_VARIANTS.resize.minPx).toBeLessThan(DRAWER_VARIANTS.resize.maxPx);
    expect(DRAWER_VARIANTS.resize.minPx).toBeGreaterThan(0);
  });
});
