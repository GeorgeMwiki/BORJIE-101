/**
 * TTS router — picks the text-to-speech provider for a given language tag
 * and latency tier.
 *
 * Policy (per `.audit/litfin-sota-2026-05-23/14-multimodal-generative.md`):
 *
 *   sw / sw-TZ / sheng → ElevenLabs v3 (best Swahili emotional intonation)
 *   lug / lg           → ElevenLabs v3 (general African coverage)
 *   yo / ig / ha       → ElevenLabs v3 (chosen over Spitch TTS for prosody;
 *                                       Spitch keeps the STT slot — see
 *                                       stt-router.ts)
 *   en / en-KE         → Cartesia Sonic-2 (40ms TTFB low-latency fallback)
 *   default            → Cartesia Sonic-2
 *
 * `tier` lets the caller bias toward latency over voice quality (e.g. for
 * back-channel acks). `'low-latency'` forces Cartesia when the language allows
 * it; `'best-quality'` (default) follows the table above.
 */

import { isCartesiaSlotLive } from '../providers/cartesia.js';
import { isElevenlabsLive } from '../providers/elevenlabs-v3.js';
import type { LanguageTag, ProviderName } from '../providers/types.js';
import {
  isEnglish,
  isLuganda,
  isNigerianLanguage,
  isSwahiliFamily,
} from './language-router.js';

export type LatencyTier = 'best-quality' | 'low-latency';

export interface TtsRoutingDecision {
  readonly provider: ProviderName;
  readonly rationale: string;
  /** True iff the chosen provider has real upstream credentials wired in. */
  readonly live?: boolean;
}

function liveness(provider: ProviderName): boolean {
  switch (provider) {
    case 'cartesia-sonic-2':
      return isCartesiaSlotLive();
    case 'elevenlabs-v3':
      return isElevenlabsLive();
    default:
      return false;
  }
}

export function routeTts(
  language: LanguageTag,
  tier: LatencyTier = 'best-quality',
): TtsRoutingDecision {
  // Caller explicitly wants the lowest possible TTFB — Cartesia regardless of
  // language. Quality on African languages is lower but it's the operator's
  // call (e.g. for short ack tokens).
  if (tier === 'low-latency') {
    return {
      provider: 'cartesia-sonic-2',
      rationale: 'Low-latency tier requested — Cartesia Sonic-2 (40ms TTFB).',
      live: liveness('cartesia-sonic-2'),
    };
  }

  if (isSwahiliFamily(language)) {
    return {
      provider: 'elevenlabs-v3',
      rationale: 'ElevenLabs v3 — best Swahili emotional intonation.',
      live: liveness('elevenlabs-v3'),
    };
  }
  if (isLuganda(language)) {
    return {
      provider: 'elevenlabs-v3',
      rationale: 'ElevenLabs v3 — general Luganda coverage.',
      live: liveness('elevenlabs-v3'),
    };
  }
  if (isNigerianLanguage(language)) {
    return {
      provider: 'elevenlabs-v3',
      rationale: 'ElevenLabs v3 — Yo / Ig / Ha prosody; Spitch keeps STT slot.',
      live: liveness('elevenlabs-v3'),
    };
  }
  if (isEnglish(language)) {
    return {
      provider: 'cartesia-sonic-2',
      rationale: 'Cartesia Sonic-2 — sub-40ms TTFB for en / en-KE.',
      live: liveness('cartesia-sonic-2'),
    };
  }
  return {
    provider: 'cartesia-sonic-2',
    rationale: 'Default fallback — Cartesia Sonic-2.',
    live: liveness('cartesia-sonic-2'),
  };
}
