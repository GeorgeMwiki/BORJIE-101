/**
 * Language router.
 *
 * Maps an inbound BCP-47-ish language hint (or detection result) to the
 * canonical `LanguageTag` the STT and TTS routers expect. Detection itself is
 * out of scope here — the caller passes whatever it has (HTTP body, prior
 * session preference, IVR menu choice) and the router normalises.
 *
 * Detection helper `detectLanguage` accepts free-form input (e.g. raw country
 * codes, mixed-case tags) and returns the canonical tag. Unknown / undefined
 * input falls through to `en` so the rest of the pipeline always has a value.
 */

import type { LanguageTag } from '../providers/types.js';

/**
 * Canonical tags we route on. Keep this list aligned with the STT / TTS
 * router policy tables — adding a new language requires touching all three.
 */
// UNIV-4: SUPPORTED_LANGUAGES hardcodes the EA/Nigeria launch language set including
// the TZ-launch sw-TZ variant. Future expansion: drive from @borjie/language-packs
// registry (one row per installed pack). Tracked gh-issue (universal-from-day-one).
// See Docs/QA/UNIVERSAL_HARDCODE_SCRUB_2026_05_26.md.
export const SUPPORTED_LANGUAGES: readonly LanguageTag[] = [
  'en',
  'en-KE',
  'sw',
  'sw-TZ',
  'sheng',
  'lug',
  'lg',
  'yo',
  'ig',
  'ha',
] as const;

/**
 * Normalise an inbound language string to a canonical `LanguageTag`. Returns
 * `'en'` (the safest default) for anything we don't recognise. Never throws —
 * the call site can always proceed with a deterministic value.
 */
export function detectLanguage(input: string | undefined | null): LanguageTag {
  if (!input) {
    return 'en';
  }
  const normalised = input.trim().toLowerCase();
  if (normalised === '') {
    return 'en';
  }

  // Exact match against the canonical list.
  const exact = SUPPORTED_LANGUAGES.find((tag) => tag.toLowerCase() === normalised);
  if (exact) {
    return exact;
  }

  // Common aliases / regional variants that map onto canonical tags.
  switch (normalised) {
    case 'en-us':
    case 'en-gb':
    case 'eng':
    case 'english':
      return 'en';
    case 'en-ke-x-mer':
    case 'kenyan-english':
      return 'en-KE';
    case 'swa':
    case 'swahili':
    case 'kiswahili':
      return 'sw';
    case 'sw-ke':
      return 'sw';
    case 'tza':
    case 'tzn':
      return 'sw-TZ';
    case 'lg':
    case 'lug':
    case 'luganda':
    case 'ganda':
      return 'lug';
    case 'yor':
    case 'yoruba':
      return 'yo';
    case 'ibo':
    case 'igbo':
      return 'ig';
    case 'hau':
    case 'hausa':
      return 'ha';
    case 'sheng':
    case 'sheng-ke':
      return 'sheng';
    default:
      return 'en';
  }
}

/** Helpful predicate the routers use to decide policy. */
export function isSwahiliFamily(tag: LanguageTag): boolean {
  return tag === 'sw' || tag === 'sw-TZ' || tag === 'sheng';
}

export function isLuganda(tag: LanguageTag): boolean {
  return tag === 'lug' || tag === 'lg';
}

export function isNigerianLanguage(tag: LanguageTag): boolean {
  return tag === 'yo' || tag === 'ig' || tag === 'ha';
}

export function isEnglish(tag: LanguageTag): boolean {
  return tag === 'en' || tag === 'en-KE';
}
