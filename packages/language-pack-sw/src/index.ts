/**
 * `@borjie/language-pack-sw` — Swahili language pack (UNIV-2).
 *
 * 2 region variants: sw-TZ (Tanzanian Kiswahili Sanifu) + sw-KE
 * (Kenyan / urban-evolving). Voice matrix: Lelapa Vulavula primary,
 * ElevenLabs v3 Swahili fallback, Google Cloud Chirp 3 tertiary —
 * Gemini Live explicitly excluded since it lacks Swahili support.
 * Dialect signals: bongo / coastal / sheng / standard. 50-entry
 * mining glossary citing Tume ya Madini, TRA, NEMC, Ministry of
 * Minerals and the Mining Act Cap.123.
 *
 * The pack carries data + handles, NOT an implementation. The
 * production composition root wires it to the registry at boot via
 * `register()`.
 */

import type { LanguagePackDefinition } from '@borjie/language-packs';

export * from './types.js';
export * from './locale.js';
export * from './voice.js';
export * from './dialect.js';
export * from './glossary-mining.js';

/**
 * The canonical pack-definition row this package registers under.
 * Matches the sw row in `SEED_PACK_DEFINITIONS`.
 */
export const SW_PACK_DEFINITION: LanguagePackDefinition = Object.freeze({
  id: 'sw',
  bcp47: 'sw',
  iso6391: 'sw',
  iso6392: 'swa',
  iso6393: 'swh',
  nativeName: 'Kiswahili',
  englishName: 'Swahili',
  script: 'Latn',
  isRtl: false,
  status: 'live',
  regionVariants: Object.freeze(['sw-TZ', 'sw-KE']),
  macrolanguage: 'swa',
  implementationPackage: '@borjie/language-pack-sw',
  morphologyPackageId: '@borjie/swahili-linguistics',
  citation: Object.freeze({
    url: 'https://www.ethnologue.com/region/Africa/',
    title: 'Languages of Africa, Ethnologue (SIL International)',
    accessedAt: '2026-05-26',
  }),
});
