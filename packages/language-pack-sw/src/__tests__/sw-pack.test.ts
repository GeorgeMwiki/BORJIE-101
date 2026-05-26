/**
 * `@borjie/language-pack-sw` tests (UNIV-2).
 *
 * Live-test discipline. Tests hit the real seed structures + the
 * real dialect classifier + the real 50-entry mining glossary.
 */

import { describe, expect, it } from 'vitest';
import {
  GEMINI_EXCLUSION_CITATION,
  SW_DIALECTS,
  SW_LOCALES,
  SW_MINING_GLOSSARY,
  SW_PACK_DEFINITION,
  SW_VOICES,
  detectSwDialect,
  findSwMiningTerm,
  resolveSwLocale,
  resolveSwVoice,
} from '../index.js';

describe('SW_PACK_DEFINITION', () => {
  it('is marked live with implementationPackage set', () => {
    expect(SW_PACK_DEFINITION.status).toBe('live');
    expect(SW_PACK_DEFINITION.implementationPackage).toBe(
      '@borjie/language-pack-sw',
    );
    expect(SW_PACK_DEFINITION.morphologyPackageId).toBe(
      '@borjie/swahili-linguistics',
    );
  });

  it('has the 2 region variants sw-TZ and sw-KE', () => {
    expect(SW_PACK_DEFINITION.regionVariants).toEqual(['sw-TZ', 'sw-KE']);
  });

  it('points at the swa macrolanguage with swh as the standard Swahili member', () => {
    expect(SW_PACK_DEFINITION.macrolanguage).toBe('swa');
    expect(SW_PACK_DEFINITION.iso6393).toBe('swh');
  });
});

describe('resolveSwLocale', () => {
  it('sw-TZ uses TZS / TSh', () => {
    const tz = resolveSwLocale('sw-TZ');
    expect(tz?.currency.code).toBe('TZS');
    expect(tz?.currency.symbol).toBe('TSh');
  });

  it('sw-KE uses KES / KSh', () => {
    const ke = resolveSwLocale('sw-KE');
    expect(ke?.currency.code).toBe('KES');
    expect(ke?.currency.symbol).toBe('KSh');
  });

  it('returns null for an unsupported variant', () => {
    expect(resolveSwLocale('sw-UG')).toBeNull();
  });

  it('both regions cite a central-bank source', () => {
    for (const tag of Object.keys(SW_LOCALES)) {
      const l = resolveSwLocale(tag);
      expect(l?.citation.url.length).toBeGreaterThan(0);
    }
  });
});

describe('resolveSwVoice', () => {
  it('returns Lelapa Vulavula as the primary provider for sw-TZ', () => {
    const v = resolveSwVoice('sw-TZ');
    expect(v?.primary.provider).toBe('lelapa-vulavula');
  });

  it('returns Lelapa Vulavula as the primary provider for sw-KE', () => {
    const v = resolveSwVoice('sw-KE');
    expect(v?.primary.provider).toBe('lelapa-vulavula');
  });

  it('falls back to ElevenLabs v3 and then Google Cloud Chirp 3', () => {
    const v = resolveSwVoice('sw-TZ');
    expect(v?.fallback?.provider).toBe('elevenlabs');
    expect(v?.tertiary?.provider).toBe('google-chirp-3');
  });

  it('rationale documents the Gemini Live exclusion', () => {
    const v = resolveSwVoice('sw-TZ');
    expect(v?.rationale).toMatch(/Gemini Live/i);
    expect(v?.rationale).toMatch(/does not (currently )?support Swahili/i);
  });

  it('GEMINI_EXCLUSION_CITATION cites the Gemini supported-languages page', () => {
    expect(GEMINI_EXCLUSION_CITATION.url).toContain('ai.google.dev');
    expect(GEMINI_EXCLUSION_CITATION.title).toMatch(/Gemini/i);
  });

  it('every voice citation has a non-empty URL + accessedAt', () => {
    for (const tag of Object.keys(SW_VOICES)) {
      const v = resolveSwVoice(tag);
      expect(v?.citation.url).toMatch(/^https?:\/\//);
      expect(v?.citation.accessedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('sw-KE prosody runs slightly faster than sw-TZ', () => {
    const tz = resolveSwVoice('sw-TZ');
    const ke = resolveSwVoice('sw-KE');
    expect((ke?.prosody.rate ?? 0)).toBeGreaterThan(tz?.prosody.rate ?? 0);
  });
});

describe('detectSwDialect (sw dialect classifier)', () => {
  it('SW_DIALECTS enumerates bongo + coastal + sheng + standard', () => {
    expect([...SW_DIALECTS].sort()).toEqual([
      'bongo',
      'coastal',
      'sheng',
      'standard',
    ]);
  });

  it('classifies a TZ-Bongo utterance as bongo', () => {
    const r = detectSwDialect(
      'mambo bongo nimepiga deal na mzee wa mrabaha kuhusu Tumemadini',
    );
    expect(r.topDialect).toBe('bongo');
    expect(r.confidence).toBeGreaterThan(0);
  });

  it('classifies a Coastal greeting register as coastal', () => {
    const r = detectSwDialect('hodi karibu bwana, jambo, kheri njema');
    expect(r.topDialect).toBe('coastal');
  });

  it('classifies a Sheng utterance as sheng', () => {
    const r = detectSwDialect('manze nikuje kwa base, mathree iko fiti, soo moja');
    expect(r.topDialect).toBe('sheng');
  });

  it('classifies a formal request register as standard', () => {
    const r = detectSwDialect(
      'Tafadhali nipe taarifa kuhusu leseni ya uchimbaji mdogo.',
    );
    expect(r.topDialect).toBe('standard');
  });

  it('returns standard with zero confidence for an empty utterance', () => {
    const r = detectSwDialect('');
    expect(r.topDialect).toBe('standard');
    expect(r.confidence).toBe(0);
  });
});

describe('SW_MINING_GLOSSARY (50 entries)', () => {
  it('contains exactly 50 entries', () => {
    expect(SW_MINING_GLOSSARY.length).toBe(50);
  });

  it('every entry carries a citation triple', () => {
    for (const e of SW_MINING_GLOSSARY) {
      expect(e.citation.url).toMatch(/^https?:\/\//);
      expect(e.citation.title.length).toBeGreaterThan(0);
      expect(e.citation.accessedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.definition.sw.length).toBeGreaterThan(0);
      expect(e.definition.en.length).toBeGreaterThan(0);
    }
  });

  it('covers TRA, Tumemadini, mrabaha, leseni, kibali (mission terms)', () => {
    expect(findSwMiningTerm('TRA')).not.toBeNull();
    expect(findSwMiningTerm('Tume ya Madini')).not.toBeNull();
    expect(findSwMiningTerm('mrabaha')?.enEquivalent).toBe('royalty');
    expect(findSwMiningTerm('leseni ya uchimbaji mdogo')?.enEquivalent).toBe(
      'Primary Mining Licence (PML)',
    );
    expect(findSwMiningTerm('kibali cha uchimbaji')?.enEquivalent).toBe(
      'mining permit',
    );
  });

  it('the mrabaha entry cites Tume ya Madini royalty rates page', () => {
    const m = findSwMiningTerm('mrabaha');
    expect(m?.citation.url).toContain('mineral-royalties');
  });

  it('the TRA entry cites the TRA website', () => {
    const t = findSwMiningTerm('TRA');
    expect(t?.citation.url).toContain('tra.go.tz');
  });

  it('returns null for an unknown term', () => {
    expect(findSwMiningTerm('xyz-not-a-real-term')).toBeNull();
  });

  it('covers at least one entry per major domain', () => {
    const domains = new Set(SW_MINING_GLOSSARY.map((e) => e.domain));
    expect(domains.has('regulator')).toBe(true);
    expect(domains.has('licensing')).toBe(true);
    expect(domains.has('royalty')).toBe(true);
    expect(domains.has('tax')).toBe(true);
    expect(domains.has('operations')).toBe(true);
    expect(domains.has('safety')).toBe(true);
    expect(domains.has('environment')).toBe(true);
    expect(domains.has('geology')).toBe(true);
  });
});
