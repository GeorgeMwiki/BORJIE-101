/**
 * `@borjie/language-sota` — public type surface.
 *
 * Wave 19G. Mirrors the 3-table schema introduced by migration
 * `0048_language_sota.sql` and defines the port contracts that keep
 * the package independent of the downstream wave packages
 * (swahili-linguistics, translation-sota, ambient-listener,
 * language-self-improve).
 *
 * Spec: `Docs/DESIGN/LANGUAGE_VOICE_SOTA_SPEC.md`.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Language enum — the four legal tags
// ---------------------------------------------------------------------------

/**
 * The legal language tags. `code-switch` is the explicit marker for an
 * utterance whose token-level tagger emitted more than one language; the
 * `codeswitchSegments` field carries the per-token breakdown.
 *
 * `sheng` is its own tag, NOT collapsed into `sw` — Sheng (Kenyan and
 * Tanzanian urban Swahili vernacular) has structural differences from
 * Standard Swahili per Githiora (2018) and Muriira (UoN MA thesis).
 */
export const LANGUAGES = ['en', 'sw', 'sheng', 'code-switch'] as const;

export type Language = (typeof LANGUAGES)[number];

/**
 * Channel discriminator — the modality the utterance was captured on.
 */
export const CHANNELS = ['voice', 'chat', 'sms', 'whatsapp'] as const;

export type Channel = (typeof CHANNELS)[number];

/**
 * Consent states aligned with FOUNDER_LOCKED_DECISIONS §3 + §4.
 *
 *  - `subject-opt-in`        — the subject explicitly toggled capture
 *                              on in the UI. Default for daily check-
 *                              ins where the user runs the session.
 *  - `org-default-learn`     — captured under the org-wide LEARN mode
 *                              default. Requires the 24-hour opt-out
 *                              window + 90-day re-consent. Tagged for
 *                              the LEARN-mode audit trail.
 *  - `single-shot-share`     — one-off "share this with X" override.
 *                              No other tier sees this row.
 *  - `voice-call-prompt`     — captured during a live voice call after
 *                              the in-call consent prompt. Auto-purged
 *                              on call hangup unless promoted.
 */
export const CONSENT_STATES = [
  'subject-opt-in',
  'org-default-learn',
  'single-shot-share',
  'voice-call-prompt',
] as const;

export type ConsentState = (typeof CONSENT_STATES)[number];

// ---------------------------------------------------------------------------
// Phoneme shape
// ---------------------------------------------------------------------------

/**
 * One IPA-tagged phoneme with timing + Goodness-of-Pronunciation score.
 *
 * Times are in milliseconds from the start of the utterance audio. `gop`
 * is the logit-based goodness-of-pronunciation score (Parikh et al.
 * Interspeech 2025) — higher is more native-like.
 */
export interface Phoneme {
  readonly ipa: string;
  readonly startMs: number;
  readonly endMs: number;
  /** Logit-based GOP score (Parikh et al., 2025). */
  readonly gop: number;
}

// ---------------------------------------------------------------------------
// Prosody shape
// ---------------------------------------------------------------------------

/**
 * Intonation shape labels. A KiSwahili yes/no question typically rises;
 * a declarative falls; an alarm utterance falls then rises (undulating).
 */
export const INTONATION_SHAPES = [
  'rising',
  'falling',
  'flat',
  'undulating',
] as const;

export type IntonationShape = (typeof INTONATION_SHAPES)[number];

/**
 * Prosody envelope. `f0Contour` is a 16-bin downsample of the F0 curve
 * extracted by pYIN (librosa convention). `stressBins` carries the
 * per-syllable stress prominence in [0, 1].
 */
export interface Prosody {
  readonly f0Contour: ReadonlyArray<number>;
  readonly stressBins: ReadonlyArray<number>;
  readonly intonationShape: IntonationShape;
}

// ---------------------------------------------------------------------------
// Code-switching segments
// ---------------------------------------------------------------------------

/**
 * A contiguous run of tokens in a single language, identified by the
 * token-level code-switch detector.
 */
export interface CodeSwitchSegment {
  readonly startToken: number;
  readonly endToken: number;
  readonly lang: Language;
  /** Detector confidence in [0, 1]. */
  readonly confidence: number;
}

// ---------------------------------------------------------------------------
// Utterance — the central row shape
// ---------------------------------------------------------------------------

/**
 * One captured utterance. Mirrors the `language_utterances` table.
 *
 * The `prevHash` and `auditHash` columns hash-chain the per-tenant
 * stream so the legibility map and right-of-access export can verify
 * the chain has not been tampered with.
 */
export interface Utterance {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly channel: Channel;
  readonly sourceLang: Language;
  readonly detectedLang: Language;
  readonly text: string;
  readonly phonemes: ReadonlyArray<Phoneme>;
  readonly prosody: Prosody;
  readonly codeswitchSegments: ReadonlyArray<CodeSwitchSegment>;
  readonly confidence: number;
  readonly provider: string | null;
  readonly consentState: ConsentState;
  readonly recordedAt: Date;
  readonly auditHash: string;
  readonly prevHash: string;
}

// ---------------------------------------------------------------------------
// Provider quality — periodic samples
// ---------------------------------------------------------------------------

export interface ProviderQuality {
  readonly id: string;
  readonly tenantId: string;
  readonly provider: string;
  readonly lang: Language;
  /** Word Error Rate in [0, 1]. */
  readonly wer: number;
  /** Phoneme Error Rate in [0, 1]. */
  readonly per: number;
  /** Mean Opinion Score in [1, 5]. */
  readonly mos: number;
  readonly measuredAt: Date;
  readonly sampleN: number;
  readonly auditHash: string;
}

// ---------------------------------------------------------------------------
// User profile — per-user language preference + pronunciation baseline
// ---------------------------------------------------------------------------

/**
 * Per-phoneme baseline. Used by the prosody-controller to bias TTS
 * output toward the user's own pronunciation pattern.
 */
export interface GopBaseline {
  readonly gopMean: number;
  readonly gopStd: number;
  readonly samples: number;
}

export interface UserLanguageProfile {
  readonly tenantId: string;
  readonly userId: string;
  readonly preferredLang: Language;
  readonly secondaryLang: Language;
  /** Per-IPA-phoneme GOP baseline. */
  readonly pronunciationProfile: Readonly<Record<string, GopBaseline>>;
  readonly dialectTags: ReadonlyArray<string>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Provider port — pluggable STT / TTS / translation
// ---------------------------------------------------------------------------

export type ProviderCapability = 'stt' | 'tts' | 'translate';

export interface SttInput {
  readonly audioRef: string;
  readonly hintedLang: Language | null;
}

export interface SttResult {
  readonly text: string;
  readonly detectedLang: Language;
  readonly confidence: number;
}

export interface TtsInput {
  readonly text: string;
  readonly lang: Language;
  /** Optional SSML override; otherwise the provider uses default prosody. */
  readonly ssml?: string;
}

export interface TtsResult {
  readonly audioRef: string;
  readonly durationMs: number;
}

export interface TranslateInput {
  readonly text: string;
  readonly fromLang: Language;
  readonly toLang: Language;
}

export interface TranslateResult {
  readonly text: string;
}

/**
 * A pluggable provider. A given provider may expose any subset of the
 * three capabilities; the registry indexes by (capability, language).
 */
export interface ProviderPort {
  readonly id: string;
  readonly capabilities: ReadonlyArray<ProviderCapability>;
  readonly supportedLanguages: ReadonlyArray<Language>;
  readonly stt?: (input: SttInput) => Promise<SttResult>;
  readonly tts?: (input: TtsInput) => Promise<TtsResult>;
  readonly translate?: (input: TranslateInput) => Promise<TranslateResult>;
}

// ---------------------------------------------------------------------------
// Detector ports — language detection ensemble
// ---------------------------------------------------------------------------

/**
 * One detector vote. The ensemble takes a majority across all signals.
 */
export interface DetectorVote {
  readonly source: 'fasttext' | 'llm' | 'whisper' | 'regex';
  readonly lang: Language;
  readonly confidence: number;
}

export interface DetectorPort {
  readonly source: DetectorVote['source'];
  detect(text: string): Promise<DetectorVote>;
}

// ---------------------------------------------------------------------------
// Phoneme + prosody ports
// ---------------------------------------------------------------------------

export interface PhonemeAlignerPort {
  /**
   * Forced-alignment driver. Returns the phoneme sequence with timing.
   * The reference implementation wraps Montreal Forced Aligner.
   */
  align(input: {
    readonly audioRef: string;
    readonly text: string;
    readonly lang: Language;
  }): Promise<ReadonlyArray<Phoneme>>;
}

export interface ProsodyExtractorPort {
  /**
   * F0 contour + stress extraction. Reference implementation wraps
   * librosa pYIN.
   */
  extract(input: {
    readonly audioRef: string;
  }): Promise<Prosody>;
}

// ---------------------------------------------------------------------------
// Repository ports — three repos, in-memory + SQL
// ---------------------------------------------------------------------------

export interface RecordUtteranceInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly channel: Channel;
  readonly sourceLang: Language;
  readonly detectedLang: Language;
  readonly text: string;
  readonly phonemes: ReadonlyArray<Phoneme>;
  readonly prosody: Prosody;
  readonly codeswitchSegments: ReadonlyArray<CodeSwitchSegment>;
  readonly confidence: number;
  readonly provider: string | null;
  readonly consentState: ConsentState;
}

export interface UtteranceRepository {
  recordUtterance(input: RecordUtteranceInput): Promise<Utterance | null>;
  findById(tenantId: string, id: string): Promise<Utterance | null>;
  listRecentForTenant(
    tenantId: string,
    limit: number,
  ): Promise<ReadonlyArray<Utterance>>;
  listRecentForUser(
    tenantId: string,
    userId: string,
    limit: number,
  ): Promise<ReadonlyArray<Utterance>>;
}

export interface RecordProviderQualityInput {
  readonly tenantId: string;
  readonly provider: string;
  readonly lang: Language;
  readonly wer: number;
  readonly per: number;
  readonly mos: number;
  readonly sampleN: number;
}

export interface ProviderQualityRepository {
  record(
    input: RecordProviderQualityInput,
  ): Promise<ProviderQuality>;
  findLatest(
    tenantId: string,
    provider: string,
    lang: Language,
  ): Promise<ProviderQuality | null>;
  listForLanguage(
    tenantId: string,
    lang: Language,
  ): Promise<ReadonlyArray<ProviderQuality>>;
}

export interface UpsertUserProfileInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly preferredLang?: Language;
  readonly secondaryLang?: Language;
  readonly pronunciationProfile?: Readonly<Record<string, GopBaseline>>;
  readonly dialectTags?: ReadonlyArray<string>;
}

export interface UserProfileRepository {
  upsert(input: UpsertUserProfileInput): Promise<UserLanguageProfile>;
  findByKey(
    tenantId: string,
    userId: string,
  ): Promise<UserLanguageProfile | null>;
  setPreferredLang(
    tenantId: string,
    userId: string,
    lang: Language,
  ): Promise<UserLanguageProfile | null>;
}

// ---------------------------------------------------------------------------
// Clock port — keep the package deterministic
// ---------------------------------------------------------------------------

export interface ClockPort {
  now(): Date;
}

// ---------------------------------------------------------------------------
// Domain error
// ---------------------------------------------------------------------------

export class LanguageSotaError extends Error {
  public override readonly name = 'LanguageSotaError';
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Zod schemas — for callers validating untyped wire data
// ---------------------------------------------------------------------------

export const phonemeSchema = z.object({
  ipa: z.string().min(1),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  gop: z.number().finite(),
});

export const prosodySchema = z.object({
  f0Contour: z.array(z.number().finite()),
  stressBins: z.array(z.number().min(0).max(1)),
  intonationShape: z.enum(INTONATION_SHAPES),
});

export const codeSwitchSegmentSchema = z.object({
  startToken: z.number().int().nonnegative(),
  endToken: z.number().int().nonnegative(),
  lang: z.enum(LANGUAGES),
  confidence: z.number().min(0).max(1),
});

export const recordUtteranceInputSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  channel: z.enum(CHANNELS),
  sourceLang: z.enum(LANGUAGES),
  detectedLang: z.enum(LANGUAGES),
  text: z.string(),
  phonemes: z.array(phonemeSchema),
  prosody: prosodySchema,
  codeswitchSegments: z.array(codeSwitchSegmentSchema),
  confidence: z.number().min(0).max(1),
  provider: z.string().nullable(),
  consentState: z.enum(CONSENT_STATES),
});

export const recordProviderQualityInputSchema = z.object({
  tenantId: z.string().min(1),
  provider: z.string().min(1),
  lang: z.enum(LANGUAGES),
  wer: z.number().min(0).max(1),
  per: z.number().min(0).max(1),
  mos: z.number().min(1).max(5),
  sampleN: z.number().int().positive(),
});

export const upsertUserProfileInputSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  preferredLang: z.enum(LANGUAGES).optional(),
  secondaryLang: z.enum(LANGUAGES).optional(),
  pronunciationProfile: z
    .record(
      z.object({
        gopMean: z.number().finite(),
        gopStd: z.number().nonnegative(),
        samples: z.number().int().nonnegative(),
      }),
    )
    .optional(),
  dialectTags: z.array(z.string()).optional(),
});
