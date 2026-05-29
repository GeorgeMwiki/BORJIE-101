import { describe, expect, it } from 'vitest';

import {
  renderScalePersonaDirective,
  renderScalePersonaSection,
} from '../scale-persona.js';

describe('scale-persona', () => {
  it('returns artisanal copy for T1 in English', () => {
    const text = renderScalePersonaDirective({
      tier: 't1_artisanal',
      language: 'en',
    });
    expect(text).toContain('ARTISANAL');
    expect(text).toContain('cash position');
  });

  it('returns industrial copy for T4 in English (CEO register)', () => {
    const text = renderScalePersonaDirective({
      tier: 't4_industrial',
      language: 'en',
    });
    expect(text).toContain('INDUSTRIAL');
    expect(text).toMatch(/CEO|Chief of Staff/);
    expect(text).toContain('EITI');
  });

  it('returns Swahili copy when language is sw', () => {
    const text = renderScalePersonaDirective({
      tier: 't2_cooperative',
      language: 'sw',
    });
    expect(text).toContain('USHIRIKA');
    expect(text).toMatch(/wafanyakazi/i);
  });

  it('coerces an unknown tier string to T1 artisanal', () => {
    const fallback = renderScalePersonaDirective({
      tier: 'bogus_value',
      language: 'en',
    });
    const t1 = renderScalePersonaDirective({
      tier: 't1_artisanal',
      language: 'en',
    });
    expect(fallback).toBe(t1);
  });

  it('coerces null tier to T1', () => {
    const out = renderScalePersonaDirective({
      tier: null,
      language: 'en',
    });
    expect(out).toContain('ARTISANAL');
  });

  it('wraps section with SCALE_REGISTER heading', () => {
    const section = renderScalePersonaSection({
      tier: 't3_midtier',
      language: 'en',
    });
    expect(section.startsWith('## SCALE_REGISTER')).toBe(true);
    expect(section).toContain('MID-TIER');
  });

  it('multi-country tier brings cross-border directives', () => {
    const en = renderScalePersonaDirective({
      tier: 't5_multi_country',
      language: 'en',
    });
    expect(en).toContain('cross-border');
    const sw = renderScalePersonaDirective({
      tier: 't5_multi_country',
      language: 'sw',
    });
    expect(sw).toContain('nchi');
  });
});
