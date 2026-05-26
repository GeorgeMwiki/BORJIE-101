/**
 * Bundled Tanzania mining-domain glossary seed.
 *
 * The glossary lock (`term-locker.ts`) merges this seed with the Wave-
 * 19H Swahili linguistics domain glossary (injected via
 * `DomainGlossaryPort`) and per-tenant overrides (from
 * `translation_glossary_overrides`).
 *
 * Sources used to build this seed:
 *   - TUMEMADINI official site — Tume ya Madini publications &
 *     regulations:
 *     https://www.tumemadini.go.tz/publications/regulations/
 *   - The Mining Act, Cap. 123 R.E. 2019 (madini.go.tz):
 *     https://www.madini.go.tz/media/CHAPTER_123_-_THE_MINING_ACT_CHAPA_FINAL.pdf
 *   - Swahilitales: Understanding Swahili Titles and Honorifics:
 *     https://swahilitales.com/vocabulary/understanding-swahili-titles-and-honorifics/
 *   - Maneno Matamu: Tanzanian vs Kenyan polite expressions:
 *     https://manenomatamu.wordpress.com/2011/11/20/swahili-kenyan-vs-tanzanian-speak-round-3-polite-expressions/
 *
 * Persona: Mr. Mwikila. Brand: Borjie. Tanzanian formal register.
 */

import type { GlossaryEntry } from '../types.js';

/**
 * Tanzania mining-act terminology + Tanzanian honorifics. Every entry
 * is bidirectional — the glossary manager indexes both directions.
 *
 * Sources cited inline via `sourceUrl`. Brand-tagged terms (PML, NEMC,
 * Tumemadini) are NEVER translated regardless of register.
 */
export const SEED_MINING_GLOSSARY: ReadonlyArray<GlossaryEntry> = Object.freeze(
  [
    // ----- Tanzania mining-licence types (brand: true — never translate) ---
    Object.freeze({
      srcTerm: 'PML',
      srcLang: 'en' as const,
      targetTerm: 'PML',
      targetLang: 'sw' as const,
      domain: 'mining' as const,
      register: 'neutral' as const,
      sourceUrl: 'https://www.tumemadini.go.tz/publications/regulations/',
      brand: true,
    }),
    Object.freeze({
      srcTerm: 'SML',
      srcLang: 'en' as const,
      targetTerm: 'SML',
      targetLang: 'sw' as const,
      domain: 'mining' as const,
      register: 'neutral' as const,
      sourceUrl: 'https://www.tumemadini.go.tz/publications/regulations/',
      brand: true,
    }),
    Object.freeze({
      srcTerm: 'ML',
      srcLang: 'en' as const,
      targetTerm: 'ML',
      targetLang: 'sw' as const,
      domain: 'mining' as const,
      register: 'neutral' as const,
      sourceUrl: 'https://www.tumemadini.go.tz/publications/regulations/',
      brand: true,
    }),
    Object.freeze({
      srcTerm: 'PCL',
      srcLang: 'en' as const,
      targetTerm: 'PCL',
      targetLang: 'sw' as const,
      domain: 'mining' as const,
      register: 'neutral' as const,
      sourceUrl: 'https://www.tumemadini.go.tz/publications/regulations/',
      brand: true,
    }),
    // ----- Regulators (brand: true) -----
    Object.freeze({
      srcTerm: 'Tumemadini',
      srcLang: 'sw' as const,
      targetTerm: 'Mining Commission',
      targetLang: 'en' as const,
      domain: 'regulatory' as const,
      register: 'formal' as const,
      sourceUrl: 'https://www.tumemadini.go.tz/about-us/functions/',
      brand: true,
    }),
    Object.freeze({
      srcTerm: 'NEMC',
      srcLang: 'en' as const,
      targetTerm: 'NEMC',
      targetLang: 'sw' as const,
      domain: 'regulatory' as const,
      register: 'neutral' as const,
      brand: true,
    }),
    // ----- Mining role terms -----
    Object.freeze({
      srcTerm: 'broker',
      srcLang: 'en' as const,
      targetTerm: 'broka',
      targetLang: 'sw' as const,
      domain: 'mining' as const,
      register: 'neutral' as const,
      sourceUrl: 'https://www.tumemadini.go.tz/publications/regulations/',
    }),
    Object.freeze({
      srcTerm: 'broka',
      srcLang: 'sw' as const,
      targetTerm: 'broker',
      targetLang: 'en' as const,
      domain: 'mining' as const,
      register: 'neutral' as const,
      sourceUrl: 'https://www.tumemadini.go.tz/publications/regulations/',
    }),
    Object.freeze({
      srcTerm: 'dealer',
      srcLang: 'en' as const,
      targetTerm: 'dila',
      targetLang: 'sw' as const,
      domain: 'mining' as const,
      register: 'neutral' as const,
      sourceUrl: 'https://www.tumemadini.go.tz/publications/regulations/',
    }),
    Object.freeze({
      srcTerm: 'dila',
      srcLang: 'sw' as const,
      targetTerm: 'dealer',
      targetLang: 'en' as const,
      domain: 'mining' as const,
      register: 'neutral' as const,
      sourceUrl: 'https://www.tumemadini.go.tz/publications/regulations/',
    }),
    // ----- Financial / regulatory terms (must survive verbatim) -----
    Object.freeze({
      srcTerm: 'royalty',
      srcLang: 'en' as const,
      targetTerm: 'mrabaha',
      targetLang: 'sw' as const,
      domain: 'financial' as const,
      register: 'formal' as const,
      sourceUrl:
        'https://www.madini.go.tz/media/CHAPTER_123_-_THE_MINING_ACT_CHAPA_FINAL.pdf',
    }),
    Object.freeze({
      srcTerm: 'mrabaha',
      srcLang: 'sw' as const,
      targetTerm: 'royalty',
      targetLang: 'en' as const,
      domain: 'financial' as const,
      register: 'formal' as const,
      sourceUrl:
        'https://www.madini.go.tz/media/CHAPTER_123_-_THE_MINING_ACT_CHAPA_FINAL.pdf',
    }),
    Object.freeze({
      srcTerm: 'parcel',
      srcLang: 'en' as const,
      targetTerm: 'parseli',
      targetLang: 'sw' as const,
      domain: 'mining' as const,
      register: 'neutral' as const,
    }),
    Object.freeze({
      srcTerm: 'parseli',
      srcLang: 'sw' as const,
      targetTerm: 'parcel',
      targetLang: 'en' as const,
      domain: 'mining' as const,
      register: 'neutral' as const,
    }),
    // ----- Units (must survive verbatim, brand: true) -----
    Object.freeze({
      srcTerm: 'USD',
      srcLang: 'en' as const,
      targetTerm: 'USD',
      targetLang: 'sw' as const,
      domain: 'financial' as const,
      register: 'neutral' as const,
      brand: true,
    }),
    Object.freeze({
      srcTerm: 'TZS',
      srcLang: 'en' as const,
      targetTerm: 'TZS',
      targetLang: 'sw' as const,
      domain: 'financial' as const,
      register: 'neutral' as const,
      brand: true,
    }),
    // ----- Honorifics (Tanzanian formal register) -----
    Object.freeze({
      srcTerm: 'Ndugu',
      srcLang: 'sw' as const,
      targetTerm: 'Dear sir or madam',
      targetLang: 'en' as const,
      domain: 'general' as const,
      register: 'formal' as const,
      sourceUrl:
        'https://swahilitales.com/vocabulary/understanding-swahili-titles-and-honorifics/',
    }),
    Object.freeze({
      srcTerm: 'Mzee',
      srcLang: 'sw' as const,
      targetTerm: 'Respected elder',
      targetLang: 'en' as const,
      domain: 'general' as const,
      register: 'formal' as const,
      sourceUrl:
        'https://swahilitales.com/vocabulary/understanding-swahili-titles-and-honorifics/',
    }),
    Object.freeze({
      srcTerm: 'Dada',
      srcLang: 'sw' as const,
      targetTerm: 'Dear sister',
      targetLang: 'en' as const,
      domain: 'general' as const,
      register: 'formal' as const,
      sourceUrl:
        'https://swahilitales.com/vocabulary/understanding-swahili-titles-and-honorifics/',
    }),
    Object.freeze({
      srcTerm: 'Mheshimiwa',
      srcLang: 'sw' as const,
      targetTerm: 'Honourable',
      targetLang: 'en' as const,
      domain: 'regulatory' as const,
      register: 'formal' as const,
      sourceUrl:
        'https://swahilitales.com/vocabulary/understanding-swahili-titles-and-honorifics/',
    }),
  ],
);

/**
 * Tanzanian formal honorific lexicon — used by the register mapper to
 * detect formal register on the source side. Lowercased.
 */
export const HONORIFIC_LEXICON_SW: ReadonlySet<string> = Object.freeze(
  new Set([
    'ndugu',
    'dada',
    'mzee',
    'mama',
    'bwana',
    'mjomba',
    'kaka',
    'bibi',
    'babu',
    'mwalimu',
    'mheshimiwa',
  ]),
) as ReadonlySet<string>;

/**
 * English honorific lexicon — used by the register mapper on the
 * reverse leg (EN → SW). Lowercased.
 */
export const HONORIFIC_LEXICON_EN: ReadonlySet<string> = Object.freeze(
  new Set([
    'dear sir',
    'dear madam',
    'dear sir or madam',
    'honourable',
    'honorable',
    'respected elder',
    'respected colleague',
    'mr.',
    'mrs.',
    'ms.',
  ]),
) as ReadonlySet<string>;
