import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OUTPUT_STYLE,
  OUTPUT_STYLES,
  OutputStyleSchema,
  parseStyleSlashCommand,
  renderOutputStyleFragment,
  resolveOutputStyle,
} from '../output-style.js';

describe('output-style — enum + schema', () => {
  it('enumerates 5 styles', () => {
    expect(OUTPUT_STYLES).toEqual([
      'terse',
      'detailed',
      'bullet',
      'narrative',
      'explanatory',
    ]);
  });

  it('defaults to detailed', () => {
    expect(DEFAULT_OUTPUT_STYLE).toBe('detailed');
  });

  it('schema validates every enum value', () => {
    for (const s of OUTPUT_STYLES) {
      expect(OutputStyleSchema.safeParse(s).success).toBe(true);
    }
  });

  it('schema rejects unknown values', () => {
    expect(OutputStyleSchema.safeParse('chatty').success).toBe(false);
  });
});

describe('resolveOutputStyle — precedence', () => {
  it('ephemeral override wins over tenant preference', () => {
    expect(
      resolveOutputStyle({
        ephemeralOverride: 'terse',
        tenantPreference: 'narrative',
      }),
    ).toBe('terse');
  });

  it('tenant preference wins when no ephemeral', () => {
    expect(
      resolveOutputStyle({
        tenantPreference: 'bullet',
      }),
    ).toBe('bullet');
  });

  it('falls back to default when neither is set', () => {
    expect(resolveOutputStyle({})).toBe(DEFAULT_OUTPUT_STYLE);
  });
});

describe('renderOutputStyleFragment — bilingual sw/en', () => {
  it('renders English fragment for terse', () => {
    const out = renderOutputStyleFragment({ style: 'terse', locale: 'en' });
    expect(out).toContain('OUTPUT STYLE: TERSE');
    expect(out).toContain('1-3 lines');
  });

  it('renders Swahili fragment for terse', () => {
    const out = renderOutputStyleFragment({ style: 'terse', locale: 'sw' });
    expect(out).toContain('MTINDO WA JIBU: FUPI');
    expect(out).toContain('mistari 1-3');
  });

  it('renders every style in both locales', () => {
    for (const style of OUTPUT_STYLES) {
      const en = renderOutputStyleFragment({ style, locale: 'en' });
      const sw = renderOutputStyleFragment({ style, locale: 'sw' });
      expect(en.length).toBeGreaterThan(0);
      expect(sw.length).toBeGreaterThan(0);
      // sw and en differ — proves bilingual.
      expect(en).not.toEqual(sw);
    }
  });
});

describe('parseStyleSlashCommand — slash parser', () => {
  it('empty args means show current', () => {
    expect(parseStyleSlashCommand('')).toEqual({ action: 'show' });
    expect(parseStyleSlashCommand('   ')).toEqual({ action: 'show' });
    expect(parseStyleSlashCommand('show')).toEqual({ action: 'show' });
  });

  it('valid style id sets the style', () => {
    expect(parseStyleSlashCommand('terse')).toEqual({
      action: 'set',
      style: 'terse',
    });
    expect(parseStyleSlashCommand('  BULLET  ')).toEqual({
      action: 'set',
      style: 'bullet',
    });
  });

  it('unknown style returns invalid with raw', () => {
    expect(parseStyleSlashCommand('chatty')).toEqual({
      action: 'invalid',
      raw: 'chatty',
    });
  });
});
