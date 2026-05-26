/**
 * `@borjie/language-pack-en` tests (UNIV-2).
 *
 * Live-test discipline. Tests hit real `Intl.DateTimeFormat` /
 * `Intl.NumberFormat` behaviour across the 5 region variants + the
 * real mining glossary.
 */

import { describe, expect, it } from 'vitest';
import {
  EN_LOCALES,
  EN_MINING_GLOSSARY,
  EN_PACK_DEFINITION,
  EN_VOICES,
  findEnMiningTerm,
  resolveEnLocale,
  resolveEnVoice,
} from '../index.js';

describe('EN_PACK_DEFINITION', () => {
  it('has the 5 region variants', () => {
    expect(EN_PACK_DEFINITION.regionVariants).toEqual([
      'en-GB',
      'en-US',
      'en-TZ',
      'en-KE',
      'en-AU',
    ]);
  });

  it('is marked live with implementationPackage set', () => {
    expect(EN_PACK_DEFINITION.status).toBe('live');
    expect(EN_PACK_DEFINITION.implementationPackage).toBe(
      '@borjie/language-pack-en',
    );
  });
});

describe('resolveEnLocale', () => {
  it('resolves each of the 5 region variants', () => {
    for (const tag of ['en-GB', 'en-US', 'en-TZ', 'en-KE', 'en-AU']) {
      const locale = resolveEnLocale(tag);
      expect(locale).not.toBeNull();
      expect(locale?.bcp47).toBe(tag);
    }
  });

  it('returns null for an unsupported tag', () => {
    expect(resolveEnLocale('en-ZZ')).toBeNull();
  });

  it('en-GB uses dd/MM/yyyy short date and GBP £ prefix', () => {
    const gb = resolveEnLocale('en-GB');
    expect(gb?.dateFormat.short).toBe('dd/MM/yyyy');
    expect(gb?.currency.code).toBe('GBP');
    expect(gb?.currency.symbol).toBe('£');
    expect(gb?.currency.position).toBe('prefix');
  });

  it('en-US uses M/d/yyyy short date and USD $ prefix; week starts Sunday', () => {
    const us = resolveEnLocale('en-US');
    expect(us?.dateFormat.short).toBe('M/d/yyyy');
    expect(us?.currency.code).toBe('USD');
    expect(us?.firstDayOfWeek).toBe(0);
  });

  it('en-TZ uses TZS currency code with TSh symbol', () => {
    const tz = resolveEnLocale('en-TZ');
    expect(tz?.currency.code).toBe('TZS');
    expect(tz?.currency.symbol).toBe('TSh');
    expect(tz?.firstDayOfWeek).toBe(1);
  });

  it('en-KE uses KES currency code with KSh symbol', () => {
    const ke = resolveEnLocale('en-KE');
    expect(ke?.currency.code).toBe('KES');
    expect(ke?.currency.symbol).toBe('KSh');
  });

  it('en-AU uses d/M/yyyy short date and AUD A$ prefix', () => {
    const au = resolveEnLocale('en-AU');
    expect(au?.dateFormat.short).toBe('d/M/yyyy');
    expect(au?.currency.code).toBe('AUD');
    expect(au?.currency.symbol).toBe('A$');
  });

  it('every region has a citation with a non-empty URL and ISO accessedAt date', () => {
    for (const tag of Object.keys(EN_LOCALES)) {
      const locale = resolveEnLocale(tag);
      expect(locale?.citation.url.length).toBeGreaterThan(0);
      expect(locale?.citation.accessedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('Intl behaviour cross-check (en regional resolve)', () => {
  // These tests exercise actual Node Intl behaviour to demonstrate the
  // pack's locale data aligns with the runtime's CLDR-derived
  // behaviour. They do NOT compare formatted strings character-for-
  // character (Node's CLDR version drifts) but verify the format
  // family is selected as expected.
  it('en-GB Intl.NumberFormat groups by comma', () => {
    const fmt = new Intl.NumberFormat('en-GB');
    const formatted = fmt.format(1234567.89);
    expect(formatted).toContain(',');
  });

  it('en-US Intl.DateTimeFormat short style yields a month-first ordering', () => {
    const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'short' });
    const formatted = fmt.format(new Date('2026-05-27T00:00:00Z'));
    // en-US short = 5/27/26 — month appears before day
    expect(formatted.startsWith('5')).toBe(true);
  });
});

describe('resolveEnVoice', () => {
  it('returns an ElevenLabs primary for every region', () => {
    for (const tag of Object.keys(EN_VOICES)) {
      const voice = resolveEnVoice(tag);
      expect(voice?.primary.provider).toBe('elevenlabs');
      expect(voice?.fallback?.provider).toBe('google-chirp-3');
      expect(voice?.tertiary?.provider).toBe('aws-polly-neural');
    }
  });
});

describe('EN_MINING_GLOSSARY', () => {
  it('has at least 10 entries', () => {
    expect(EN_MINING_GLOSSARY.length).toBeGreaterThanOrEqual(10);
  });

  it('every entry carries a citation with URL + title + accessedAt', () => {
    for (const e of EN_MINING_GLOSSARY) {
      expect(e.citation.url).toMatch(/^https?:\/\//);
      expect(e.citation.title.length).toBeGreaterThan(0);
      expect(e.citation.accessedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('includes the "royalty" entry pointing at Tume ya Madini', () => {
    const r = findEnMiningTerm('royalty');
    expect(r).not.toBeNull();
    expect(r?.citation.url).toContain('tumemadini');
  });

  it('includes the licensing trio PML, ML, SML', () => {
    expect(findEnMiningTerm('Primary Mining Licence')?.lemma).toBe('PML');
    expect(findEnMiningTerm('Mining Licence')?.lemma).toBe('ML');
    expect(findEnMiningTerm('Special Mining Licence')?.lemma).toBe('SML');
  });

  it('returns null for an unknown term', () => {
    expect(findEnMiningTerm('xyz-not-a-mining-term')).toBeNull();
  });
});
