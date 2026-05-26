/**
 * Brand-lock tests — rejects raw hex; accepts token references.
 *
 * Covers spec §4 Layer 3 + §9 anti-pattern "Render off-brand. brand-lint
 * refuses raw HTML / non-token colors / unregistered fonts.".
 */

import { describe, expect, it } from 'vitest';
import {
  isBrandColor,
  isBrandCssVar,
  isBrandFont,
  isOklchInGamut,
  lintBrand,
  BRAND_COLOR_PALETTE,
} from '../brand-lock/index.js';
import {
  validateHtmlBrand,
  validateNativeBrandColors,
  validateNativeBrandFonts,
} from '../brand-lock/brand-validator.js';

describe('brand-lock palette membership', () => {
  it('accepts every registered hex literal', () => {
    for (const c of BRAND_COLOR_PALETTE) {
      expect(isBrandColor(c)).toBe(true);
    }
  });

  it('rejects a random off-brand hex', () => {
    expect(isBrandColor('#ff00ff')).toBe(false);
    expect(isBrandColor('#abcdef')).toBe(false);
  });

  it('accepts case-insensitive hex', () => {
    expect(isBrandColor('#1f3864')).toBe(true);
    expect(isBrandColor('#1F3864')).toBe(true);
    expect(isBrandColor('1F3864')).toBe(true);
  });

  it('treats an empty string as not a brand color', () => {
    expect(isBrandColor('')).toBe(false);
  });
});

describe('brand-lock CSS variable references', () => {
  it('accepts registered token prefixes', () => {
    expect(isBrandCssVar('var(--color-brand-500)')).toBe(true);
    expect(isBrandCssVar('var(--color-neutral-200)')).toBe(true);
    expect(isBrandCssVar('var(--color-fg)')).toBe(true);
  });

  it('rejects unregistered CSS variables', () => {
    expect(isBrandCssVar('var(--my-custom-color)')).toBe(false);
    expect(isBrandCssVar('var(--color-rogue)')).toBe(false);
  });

  it('rejects malformed CSS variable references', () => {
    expect(isBrandCssVar('--color-brand-500')).toBe(false);
    expect(isBrandCssVar('var(color-brand-500)')).toBe(false);
  });
});

describe('brand-lock OKLCH gamut', () => {
  it('accepts in-gamut OKLCH values', () => {
    expect(isOklchInGamut('oklch(0.7 0.18 240)')).toBe(true);
    expect(isOklchInGamut('oklch(0.5 0.1 100 / 0.8)')).toBe(true);
  });

  it('rejects OKLCH values with chroma out of gamut', () => {
    expect(isOklchInGamut('oklch(0.7 0.9 100)')).toBe(false);
  });

  it('rejects malformed OKLCH', () => {
    expect(isOklchInGamut('oklch(garbage)')).toBe(false);
    expect(isOklchInGamut('rgb(255, 0, 0)')).toBe(false);
  });
});

describe('brand-lock font registry', () => {
  it('accepts registered families', () => {
    expect(isBrandFont('Inter')).toBe(true);
    expect(isBrandFont('"Inter", system-ui, sans-serif')).toBe(true);
    expect(isBrandFont('JetBrains Mono, monospace')).toBe(true);
  });

  it('rejects unregistered families', () => {
    expect(isBrandFont('Comic Sans MS')).toBe(false);
    expect(isBrandFont('Papyrus')).toBe(false);
  });

  it('rejects a stack containing a non-registered family', () => {
    expect(isBrandFont('Inter, "Comic Sans"')).toBe(false);
  });

  it('rejects an empty font specification', () => {
    expect(isBrandFont('')).toBe(false);
  });
});

describe('lintBrand aggregator', () => {
  it('returns ok when every color + font is registered', () => {
    const result = lintBrand({
      colors: ['#1F3864', 'var(--color-brand-500)', 'oklch(0.7 0.18 240)'],
      fonts: ['Inter', 'JetBrains Mono'],
    });
    expect(result.ok).toBe(true);
  });

  it('surfaces violations for unknown colors', () => {
    const result = lintBrand({
      colors: ['#ff00ff'],
      fonts: ['Inter'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.violations[0]).toContain('unknown_color');
  });

  it('surfaces violations for unknown fonts', () => {
    const result = lintBrand({
      colors: ['#1F3864'],
      fonts: ['Comic Sans MS'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.violations[0]).toContain('unknown_font');
  });
});

describe('validateHtmlBrand', () => {
  it('accepts clean HTML with brand classes and registered colours', () => {
    const html = `<!doctype html><html><body class="brj-body"><p class="brj-p" data-color="#1F3864">Hi</p></body></html>`;
    const result = validateHtmlBrand(html);
    expect(result.ok).toBe(true);
  });

  it('rejects HTML with raw inline styles', () => {
    const html = `<p style="color: red">Hi</p>`;
    const result = validateHtmlBrand(html);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.violations.some((v) => v.startsWith('inline_style:'))).toBe(true);
  });

  it('rejects HTML with non-token hex literals', () => {
    const html = `<p class="brj-p" data-color="#aabbcc">Hi</p>`;
    const result = validateHtmlBrand(html);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.violations.some((v) => v.includes('#aabbcc'))).toBe(true);
  });

  it('rejects HTML with rgb literals (disallowed colour form)', () => {
    const html = `<p>rgb(255, 0, 0)</p>`;
    const result = validateHtmlBrand(html);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.violations.some((v) => v.startsWith('disallowed_color_form:'))).toBe(true);
  });

  it('rejects font-family declarations with unregistered families', () => {
    const html = `<style>body { font-family: Comic Sans MS; }</style>`;
    const result = validateHtmlBrand(html);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.violations.some((v) => v.startsWith('unknown_font:'))).toBe(true);
  });

  it('rejects out-of-gamut OKLCH literals', () => {
    const html = `<style>p { color: oklch(0.7 0.9 240); }</style>`;
    const result = validateHtmlBrand(html);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.violations.some((v) => v.startsWith('oklch_out_of_gamut:'))).toBe(true);
  });
});

describe('validateNativeBrandColors / Fonts', () => {
  it('accepts a full clean colour list', () => {
    const result = validateNativeBrandColors(['#1F3864', '#C45B12', '#0f172a']);
    expect(result.ok).toBe(true);
  });

  it('rejects when any colour is off-palette', () => {
    const result = validateNativeBrandColors(['#1F3864', '#ff00ff']);
    expect(result.ok).toBe(false);
  });

  it('accepts a clean font list', () => {
    const result = validateNativeBrandFonts(['Inter']);
    expect(result.ok).toBe(true);
  });

  it('rejects unregistered fonts', () => {
    const result = validateNativeBrandFonts(['Papyrus']);
    expect(result.ok).toBe(false);
  });
});
