import { describe, expect, it } from 'vitest';
import {
  ALL_THEMES,
  DARK,
  HIGH_CONTRAST,
  LIGHT,
  renderCss,
} from '../theme-tokens.js';

describe('theme-tokens', () => {
  it('all 3 themes registered', () => {
    expect(Object.keys(ALL_THEMES)).toEqual(
      expect.arrayContaining(['light', 'dark', 'high-contrast']),
    );
  });

  it('every theme has --background and --foreground', () => {
    for (const theme of Object.values(ALL_THEMES)) {
      expect(theme.tokens['--background']).toBeTypeOf('string');
      expect(theme.tokens['--foreground']).toBeTypeOf('string');
    }
  });

  it('every theme exposes --radius', () => {
    for (const theme of Object.values(ALL_THEMES)) {
      expect(theme.tokens['--radius']).toBeTypeOf('string');
    }
  });

  it('HIGH_CONTRAST uses pure black/white for max contrast', () => {
    expect(HIGH_CONTRAST.tokens['--background']).toBe('oklch(100% 0 0)');
    expect(HIGH_CONTRAST.tokens['--foreground']).toBe('oklch(0% 0 0)');
  });

  it('LIGHT and DARK differ on --background', () => {
    expect(LIGHT.tokens['--background']).not.toBe(DARK.tokens['--background']);
  });

  it('renderCss produces parseable CSS block', () => {
    const css = renderCss(LIGHT, ':root');
    expect(css.startsWith(':root {')).toBe(true);
    expect(css.endsWith('}')).toBe(true);
    expect(css).toContain('--background:');
  });

  it('renderCss respects selector arg', () => {
    expect(renderCss(DARK, '.dark').startsWith('.dark {')).toBe(true);
  });

  it('all theme color tokens use OKLCH', () => {
    for (const theme of Object.values(ALL_THEMES)) {
      for (const [k, v] of Object.entries(theme.tokens)) {
        if (k.endsWith('-foreground') || k === '--background' || k === '--primary') {
          expect(v).toContain('oklch');
        }
      }
    }
  });
});
