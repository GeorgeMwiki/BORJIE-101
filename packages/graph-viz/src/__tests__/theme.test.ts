/**
 * OKLCH brand theme tests — verifies palette emits valid CSS color
 * strings AND stays stable for the same `kind` across renders.
 */

import { describe, it, expect } from 'vitest';
import {
  BRAND_LIGHT_THEME,
  BRAND_DARK_THEME,
  getBrandTheme,
  pickCategoricalColor,
  isValidThemeColor,
} from '../themes/oklch-brand-theme';

describe('OKLCH brand theme', () => {
  it('exports light and dark variants with the same swatch keys', () => {
    const lightKeys = Object.keys(BRAND_LIGHT_THEME).sort();
    const darkKeys  = Object.keys(BRAND_DARK_THEME).sort();
    expect(lightKeys).toEqual(darkKeys);
  });

  it('every swatch in the light theme parses as a valid OKLCH or hex color', () => {
    const swatches = [
      BRAND_LIGHT_THEME.background,
      BRAND_LIGHT_THEME.foreground,
      BRAND_LIGHT_THEME.surface,
      BRAND_LIGHT_THEME.border,
      BRAND_LIGHT_THEME.muted,
      BRAND_LIGHT_THEME.signal,
      BRAND_LIGHT_THEME.signalDeep,
      BRAND_LIGHT_THEME.nodeFill,
      BRAND_LIGHT_THEME.nodeStroke,
      BRAND_LIGHT_THEME.nodeSelected,
      BRAND_LIGHT_THEME.nodeHover,
      BRAND_LIGHT_THEME.edgeStroke,
      BRAND_LIGHT_THEME.edgeHighlight,
      ...BRAND_LIGHT_THEME.categorical10,
      ...BRAND_LIGHT_THEME.sequential7,
      ...BRAND_LIGHT_THEME.diverging7,
    ];
    for (const s of swatches) {
      expect(isValidThemeColor(s.oklch)).toBe(true);
      expect(isValidThemeColor(s.hex)).toBe(true);
    }
  });

  it('every swatch in the dark theme parses as a valid OKLCH or hex color', () => {
    const swatches = [
      BRAND_DARK_THEME.background,
      BRAND_DARK_THEME.foreground,
      BRAND_DARK_THEME.surface,
      BRAND_DARK_THEME.border,
      BRAND_DARK_THEME.muted,
      BRAND_DARK_THEME.signal,
      BRAND_DARK_THEME.signalDeep,
      BRAND_DARK_THEME.nodeFill,
      BRAND_DARK_THEME.nodeStroke,
      BRAND_DARK_THEME.nodeSelected,
      BRAND_DARK_THEME.nodeHover,
      BRAND_DARK_THEME.edgeStroke,
      BRAND_DARK_THEME.edgeHighlight,
      ...BRAND_DARK_THEME.categorical10,
    ];
    for (const s of swatches) {
      expect(isValidThemeColor(s.oklch)).toBe(true);
      expect(isValidThemeColor(s.hex)).toBe(true);
    }
  });

  it('rejects obvious garbage as not a theme color', () => {
    expect(isValidThemeColor('')).toBe(false);
    expect(isValidThemeColor('not a color')).toBe(false);
    expect(isValidThemeColor('rgb(255,255,255)')).toBe(false);
    expect(isValidThemeColor('hsl(30 18% 12%)')).toBe(false);
  });

  it('getBrandTheme picks the correct variant', () => {
    expect(getBrandTheme('brand-light').name).toBe('brand-light');
    expect(getBrandTheme('brand-dark').name).toBe('brand-dark');
    expect(getBrandTheme().name).toBe('brand-light');
  });

  it('pickCategoricalColor is stable for the same key across calls', () => {
    const theme = getBrandTheme();
    const a = pickCategoricalColor(theme, 'royalty-payer');
    const b = pickCategoricalColor(theme, 'royalty-payer');
    expect(a.hex).toBe(b.hex);
    expect(a.oklch).toBe(b.oklch);
  });

  it('pickCategoricalColor distributes across the categorical palette', () => {
    const theme = getBrandTheme();
    const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];
    const hexes = new Set(keys.map((k) => pickCategoricalColor(theme, k).hex));
    expect(hexes.size).toBeGreaterThanOrEqual(4);
  });
});
