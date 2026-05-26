/**
 * Pack-internal shared types (UNIV-2).
 *
 * The shapes used across `locale.ts`, `voice.ts`, `glossary-mining.ts`.
 * Mirror the spec §4 (locale) and §5 (voice) definitions.
 */

import type { Citation } from '@borjie/language-packs';

// ---------------------------------------------------------------------------
// Locale resources (CLDR-derived)
// ---------------------------------------------------------------------------

export interface LocaleDateFormat {
  /** date pattern in LDML TR-35 syntax (e.g. 'dd/MM/yyyy', 'MM/dd/yyyy') */
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
  /** ISO 4217 code */
  readonly code: string;
  /** display symbol (e.g. '$', '£', 'KSh', 'TSh') */
  readonly symbol: string;
  /** symbol position relative to the amount */
  readonly position: 'prefix' | 'suffix';
}

export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface LocaleResources {
  /** BCP-47 tag, e.g. 'en-GB' */
  readonly bcp47: string;
  readonly dateFormat: LocaleDateFormat;
  readonly numberFormat: LocaleNumberFormat;
  readonly currency: LocaleCurrencyFormat;
  readonly firstDayOfWeek: WeekdayIndex;
  readonly weekendDays: ReadonlyArray<WeekdayIndex>;
  /** CLDR / ICU collation rule key */
  readonly collation: string;
  /** citation supporting the locale data */
  readonly citation: Citation;
}

// ---------------------------------------------------------------------------
// Voice profile
// ---------------------------------------------------------------------------

export type VoiceProvider =
  | 'elevenlabs'
  | 'google-chirp-3'
  | 'aws-polly-neural'
  | 'lelapa-vulavula'
  | 'azure-neural';

export interface VoiceProsody {
  /** semitone offset from baseline */
  readonly pitch: number;
  /** speech rate multiplier (1.0 = baseline) */
  readonly rate: number;
  /** energy / amplitude multiplier */
  readonly energy: number;
}

export interface VoiceProfile {
  readonly bcp47: string;
  readonly primary: { readonly provider: VoiceProvider; readonly voiceId: string };
  readonly fallback: { readonly provider: VoiceProvider; readonly voiceId: string } | null;
  readonly tertiary: { readonly provider: VoiceProvider; readonly voiceId: string } | null;
  readonly prosody: VoiceProsody;
  readonly citation: Citation;
}

// ---------------------------------------------------------------------------
// Mining glossary
// ---------------------------------------------------------------------------

export interface MiningGlossaryEntry {
  readonly term: string;
  readonly lemma: string;
  readonly enEquivalent: string;
  readonly domain: string;
  readonly register: string;
  readonly definition: {
    readonly en: string;
    readonly localised: string | null;
  };
  readonly citation: Citation;
}
