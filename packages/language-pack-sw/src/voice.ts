/**
 * Swahili voice profiles (UNIV-2).
 *
 * Three-tier provider matrix:
 *   primary  = Lelapa Vulavula — the only African-owned TTS stack with
 *              first-class Swahili coverage (per Wave 19G finding).
 *   fallback = ElevenLabs v3 Swahili — broad multi-locale support.
 *   tertiary = Google Cloud Chirp 3 — general-purpose multilingual.
 *
 * Gemini Live is EXPLICITLY EXCLUDED for Swahili because it does not
 * currently support the language (per Google's published Gemini
 * supported-languages list, accessed 2026-05-26). When Gemini Live
 * ships Swahili coverage, the matrix can be re-evaluated through a
 * Wave 19F spec amendment, not a hardcoded code change.
 *
 * Citations:
 *   - Lelapa AI — Vulavula speech & language models for African languages
 *     https://lelapa.ai/ (accessed 2026-05-26)
 *   - ElevenLabs — Eleven v3 announcement
 *     https://elevenlabs.io/blog/eleven-v3 (accessed 2026-05-26)
 *   - Google Cloud Text-to-Speech Chirp 3 HD
 *     https://cloud.google.com/text-to-speech/docs/chirp3-hd (accessed 2026-05-26)
 *   - Gemini API supported languages (proof of Swahili exclusion)
 *     https://ai.google.dev/gemini-api/docs/models/gemini#available-languages
 *     (accessed 2026-05-26)
 */

import type { Citation } from '@borjie/language-packs';
import type { VoiceProfile } from './types.js';

const ACCESSED = '2026-05-26';

const LELAPA: Citation = Object.freeze({
  url: 'https://lelapa.ai/',
  title: 'Lelapa AI — Vulavula speech & language models for African languages',
  accessedAt: ACCESSED,
});

const GEMINI_LANGS: Citation = Object.freeze({
  url: 'https://ai.google.dev/gemini-api/docs/models/gemini#available-languages',
  title: 'Gemini API — supported languages, Google AI for Developers',
  accessedAt: ACCESSED,
});

const RATIONALE =
  'Lelapa Vulavula primary (Wave 19G finding — African-owned, native Swahili). ' +
  'ElevenLabs v3 fallback (broad multilocale support). Google Cloud Chirp 3 ' +
  'tertiary (general-purpose backstop). Gemini Live is intentionally excluded ' +
  'because it does not currently support Swahili (see Gemini supported-' +
  'languages citation).';

export const SW_TZ_VOICE: VoiceProfile = Object.freeze({
  bcp47: 'sw-TZ',
  primary: Object.freeze({
    provider: 'lelapa-vulavula',
    voiceId: 'vulavula-sw-tz-female-standard',
  }),
  fallback: Object.freeze({
    provider: 'elevenlabs',
    voiceId: 'eleven-v3-sw-female-tz',
  }),
  tertiary: Object.freeze({
    provider: 'google-chirp-3',
    voiceId: 'sw-TZ-Chirp3-HD',
  }),
  // sw-TZ defaults to the formal/Bongo register — neutral prosody.
  prosody: Object.freeze({ pitch: 0, rate: 1.0, energy: 1.0 }),
  citation: LELAPA,
  rationale: RATIONALE,
});

export const SW_KE_VOICE: VoiceProfile = Object.freeze({
  bcp47: 'sw-KE',
  primary: Object.freeze({
    provider: 'lelapa-vulavula',
    voiceId: 'vulavula-sw-ke-female-standard',
  }),
  fallback: Object.freeze({
    provider: 'elevenlabs',
    voiceId: 'eleven-v3-sw-female-ke',
  }),
  tertiary: Object.freeze({
    provider: 'google-chirp-3',
    voiceId: 'sw-KE-Chirp3-HD',
  }),
  // sw-KE defaults to the standard/Kenyan register; slightly faster
  // rate per the Talkpal TZ-vs-KE register observation.
  prosody: Object.freeze({ pitch: 0, rate: 1.05, energy: 1.0 }),
  citation: LELAPA,
  rationale: RATIONALE,
});

export const SW_VOICES: Readonly<Record<string, VoiceProfile>> = Object.freeze({
  'sw-TZ': SW_TZ_VOICE,
  'sw-KE': SW_KE_VOICE,
});

export function resolveSwVoice(bcp47: string): VoiceProfile | null {
  return SW_VOICES[bcp47] ?? null;
}

/** Citation supporting the Gemini-Live exclusion. */
export const GEMINI_EXCLUSION_CITATION: Citation = GEMINI_LANGS;
