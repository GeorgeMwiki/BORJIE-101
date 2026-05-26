/**
 * `@borjie/language-pack-en` — English language pack (UNIV-2).
 *
 * 5 region variants: en-GB, en-US, en-TZ, en-KE, en-AU.
 * Voice matrix: ElevenLabs v3 primary, Google Cloud Chirp 3 fallback,
 * AWS Polly Neural tertiary.
 * Mining-domain bilingual glossary (12 entries at launch; extended in
 * follow-on waves per the vertical-profile roadmap).
 *
 * The pack carries data + handles, NOT an implementation. The
 * production composition root wires it to the registry at boot via
 * `register()`.
 */

import type { LanguagePackDefinition } from '@borjie/language-packs';

export * from './types.js';
export * from './locale.js';
export * from './voice.js';
export * from './glossary-mining.js';

/**
 * The canonical pack-definition row this package registers under.
 * Matches the en row in `SEED_PACK_DEFINITIONS`.
 */
export const EN_PACK_DEFINITION: LanguagePackDefinition = Object.freeze({
  id: 'en',
  bcp47: 'en',
  iso6391: 'en',
  iso6392: 'eng',
  iso6393: 'eng',
  nativeName: 'English',
  englishName: 'English',
  script: 'Latn',
  isRtl: false,
  status: 'live',
  regionVariants: Object.freeze(['en-GB', 'en-US', 'en-TZ', 'en-KE', 'en-AU']),
  macrolanguage: null,
  implementationPackage: '@borjie/language-pack-en',
  morphologyPackageId: null,
  citation: Object.freeze({
    url: 'https://tools.ietf.org/html/rfc5646',
    title: 'RFC 5646 — Tags for Identifying Languages, IETF',
    accessedAt: '2026-05-26',
  }),
});
