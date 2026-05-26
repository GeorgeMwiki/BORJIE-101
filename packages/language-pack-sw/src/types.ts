/**
 * Pack-internal shared types (UNIV-2).
 *
 * Mirrors the shapes from `@borjie/language-pack-en/types.ts` with
 * additional dialect support for Swahili. We re-declare locally rather
 * than cross-import the en pack to keep each pack independently
 * installable.
 */

import type { Citation } from '@borjie/language-packs';

// ---------------------------------------------------------------------------
// Locale resources
// ---------------------------------------------------------------------------

export interface LocaleDateFormat {
  readonly short: string;
  readonly medium: string;
  readonly long: string;
  readonly full: string;
}

export interface LocaleNumberFormat {
  readonly decimalSeparator: string;
  readonly groupSeparator: string;
  readonly fractionDigits: number;
}

export interface LocaleCurrencyFormat {
  readonly code: string;
  readonly symbol: string;
  readonly position: 'prefix' | 'suffix';
}

export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface LocaleResources {
  readonly bcp47: string;
  readonly dateFormat: LocaleDateFormat;
  readonly numberFormat: LocaleNumberFormat;
  readonly currency: LocaleCurrencyFormat;
  readonly firstDayOfWeek: WeekdayIndex;
  readonly weekendDays: ReadonlyArray<WeekdayIndex>;
  readonly collation: string;
  readonly citation: Citation;
}

// ---------------------------------------------------------------------------
// Voice profile
// ---------------------------------------------------------------------------

export type VoiceProvider =
  | 'lelapa-vulavula'
  | 'elevenlabs'
  | 'google-chirp-3'
  | 'aws-polly-neural';

export interface VoiceProsody {
  readonly pitch: number;
  readonly rate: number;
  readonly energy: number;
}

export interface VoiceProfile {
  readonly bcp47: string;
  readonly primary: {
    readonly provider: VoiceProvider;
    readonly voiceId: string;
  };
  readonly fallback: {
    readonly provider: VoiceProvider;
    readonly voiceId: string;
  } | null;
  readonly tertiary: {
    readonly provider: VoiceProvider;
    readonly voiceId: string;
  } | null;
  readonly prosody: VoiceProsody;
  readonly citation: Citation;
  /** rationale for the matrix choice (e.g. why Gemini Live is excluded) */
  readonly rationale: string;
}

// ---------------------------------------------------------------------------
// Dialect
// ---------------------------------------------------------------------------

export const SW_DIALECTS = [
  'bongo',
  'coastal',
  'sheng',
  'standard',
] as const;

export type SwDialect = (typeof SW_DIALECTS)[number];

export interface SwDialectScore {
  readonly dialect: SwDialect;
  readonly score: number;
  readonly signals: ReadonlyArray<string>;
}

export interface SwDialectDetectionResult {
  readonly scores: ReadonlyArray<SwDialectScore>;
  readonly topDialect: SwDialect;
  readonly confidence: number;
}

// ---------------------------------------------------------------------------
// Mining glossary
// ---------------------------------------------------------------------------

export interface SwMiningGlossaryEntry {
  readonly term: string;
  readonly lemma: string;
  readonly enEquivalent: string;
  readonly domain: string;
  readonly register: string;
  readonly definition: {
    readonly sw: string;
    readonly en: string;
  };
  readonly citation: Citation;
}
