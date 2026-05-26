/**
 * English voice profiles (UNIV-2).
 *
 * Three-tier provider matrix per region variant:
 *   primary  = ElevenLabs v3 (industry-leading naturalness + low latency)
 *   fallback = Google Cloud Chirp 3 (broad regional coverage)
 *   tertiary = AWS Polly Neural (mature, deeply regional)
 *
 * Voice ids are placeholders the production composition root will swap
 * for tenant-licensed credentials. The pack carries handles, not
 * implementations.
 *
 * Citations:
 *   - ElevenLabs v3 announcement
 *     https://elevenlabs.io/blog/eleven-v3 (accessed 2026-05-26)
 *   - Google Cloud Text-to-Speech Chirp 3
 *     https://cloud.google.com/text-to-speech/docs/chirp3-hd (accessed 2026-05-26)
 *   - AWS Polly Neural voices
 *     https://docs.aws.amazon.com/polly/latest/dg/voicelist.html
 *     (accessed 2026-05-26)
 */

import type { Citation } from '@borjie/language-packs';
import type { VoiceProfile } from './types.js';

const ACCESSED = '2026-05-26';

const ELEVENLABS_CITATION: Citation = Object.freeze({
  url: 'https://elevenlabs.io/blog/eleven-v3',
  title: 'ElevenLabs v3 — Most Expressive Text-to-Speech Model',
  accessedAt: ACCESSED,
});

const POLLY_CITATION: Citation = Object.freeze({
  url: 'https://docs.aws.amazon.com/polly/latest/dg/voicelist.html',
  title: 'AWS Polly — Available Voices',
  accessedAt: ACCESSED,
});

const NEUTRAL_PROSODY = Object.freeze({ pitch: 0, rate: 1.0, energy: 1.0 });

function makeProfile(
  bcp47: string,
  primaryVoiceId: string,
  fallbackVoiceId: string,
  tertiaryVoiceId: string,
  citation: Citation,
): VoiceProfile {
  return Object.freeze({
    bcp47,
    primary: Object.freeze({
      provider: 'elevenlabs',
      voiceId: primaryVoiceId,
    }),
    fallback: Object.freeze({
      provider: 'google-chirp-3',
      voiceId: fallbackVoiceId,
    }),
    tertiary: Object.freeze({
      provider: 'aws-polly-neural',
      voiceId: tertiaryVoiceId,
    }),
    prosody: NEUTRAL_PROSODY,
    citation,
  });
}

// ---------------------------------------------------------------------------
// Region profiles
// ---------------------------------------------------------------------------

export const EN_GB_VOICE: VoiceProfile = makeProfile(
  'en-GB',
  'Charlotte', // ElevenLabs v3
  'en-GB-Chirp3-HD',
  'Amy', // Polly neural
  ELEVENLABS_CITATION,
);

export const EN_US_VOICE: VoiceProfile = makeProfile(
  'en-US',
  'Rachel',
  'en-US-Chirp3-HD',
  'Joanna',
  ELEVENLABS_CITATION,
);

export const EN_TZ_VOICE: VoiceProfile = makeProfile(
  'en-TZ',
  'Charlotte', // EN-EAST African profile, closest in registry
  'en-GB-Chirp3-HD',
  'Amy',
  POLLY_CITATION,
);

export const EN_KE_VOICE: VoiceProfile = makeProfile(
  'en-KE',
  'Charlotte',
  'en-GB-Chirp3-HD',
  'Amy',
  POLLY_CITATION,
);

export const EN_AU_VOICE: VoiceProfile = makeProfile(
  'en-AU',
  'Charlotte', // ElevenLabs covers en-AU via accent control
  'en-AU-Chirp3-HD',
  'Olivia',
  POLLY_CITATION,
);

export const EN_VOICES: Readonly<Record<string, VoiceProfile>> = Object.freeze({
  'en-GB': EN_GB_VOICE,
  'en-US': EN_US_VOICE,
  'en-TZ': EN_TZ_VOICE,
  'en-KE': EN_KE_VOICE,
  'en-AU': EN_AU_VOICE,
});

export function resolveEnVoice(bcp47: string): VoiceProfile | null {
  return EN_VOICES[bcp47] ?? null;
}
