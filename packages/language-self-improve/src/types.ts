/**
 * `@borjie/language-self-improve` — public type surface (Wave 19K).
 *
 * Companion to Docs/DESIGN/LANGUAGE_SELF_IMPROVE_SPEC.md. Every type is
 * `readonly` end-to-end (the project immutability rule from
 * ~/.claude/rules/coding-style.md). Numeric scores live in `[0, 1]`
 * unless otherwise documented.
 *
 * Locked default per FOUNDER_LOCKED_DECISIONS_2026_05_26.md §1.3 + §1.4
 * — every captured utterance carries a `provenance.consent_state` in
 * `scores.recipient_consent` so downstream readers can render recipient-
 * aware redaction.
 */

// ---------------------------------------------------------------------------
// Language tag
// ---------------------------------------------------------------------------

/**
 * The language tag for a training pair / gauntlet entry. We default to
 * `sw` (Swahili) for the Tanzanian mining domain, with explicit
 * sub-tags for dialects that an upstream linguistics port may surface.
 */
export type LanguageTag =
  | 'sw'
  | 'sw-bongo'
  | 'sw-coast'
  | 'sw-lake'
  | 'sheng'
  | 'en'
  | (string & {});

export type Dialect = 'bongo' | 'coast' | 'lake' | 'sheng' | 'other';

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * The 4-axis language quality score for a single utterance / pair.
 * All four axes are `[0, 1]` where:
 *
 *   - `wer` and `per` — lower is better (these are error rates).
 *   - `grammar` and `terminology` — higher is better.
 *
 * `aggregate` is a convenience field — the runner / curator computes it
 * as `(1 - wer) * 0.3 + (1 - per) * 0.2 + grammar * 0.25 + terminology *
 * 0.25` (weights surfaced via `LanguageScoreWeights`).
 */
export interface LanguageScore {
  readonly wer: number;
  readonly per: number;
  readonly grammar: number;
  readonly terminology: number;
  readonly aggregate: number;
  /** Per FOUNDER_LOCKED_DECISIONS §1.4. */
  readonly recipientConsent:
    | 'org-default-learn'
    | 'per-user-balanced'
    | 'per-user-learn';
}

export interface LanguageScoreWeights {
  readonly wer: number;
  readonly per: number;
  readonly grammar: number;
  readonly terminology: number;
}

export const DEFAULT_LANGUAGE_SCORE_WEIGHTS: LanguageScoreWeights = Object.freeze({
  wer: 0.3,
  per: 0.2,
  grammar: 0.25,
  terminology: 0.25,
});

// ---------------------------------------------------------------------------
// Training pair
// ---------------------------------------------------------------------------

export interface TrainingPair {
  readonly id: string;
  readonly tenantId: string;
  readonly sourceText: string;
  readonly targetText: string;
  readonly lang: LanguageTag;
  readonly utteranceId: string | null;
  readonly scores: LanguageScore;
  readonly included: boolean;
  readonly exclusionReason: string | null;
  readonly recordedAt: string;
  readonly auditHash: string;
  readonly prevHash: string;
}

export type ExclusionReason =
  | 'duplicate'
  | 'pii_redaction_failed'
  | 'dialect_overweighted'
  | 'consent_denied'
  | 'low_signal'
  | 'novel_term_quota_exceeded';

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export type AdapterKind = 'lora' | 'rag-prefix' | 'full-ft';
export type AdapterStatus =
  | 'training'
  | 'staged'
  | 'live'
  | 'rolled-back'
  | 'deprecated';

export interface Adapter {
  readonly id: string;
  readonly tenantId: string;
  readonly lang: LanguageTag;
  readonly version: string;
  readonly adapterKind: AdapterKind;
  readonly baseModel: string;
  readonly trainingPairCount: number;
  readonly status: AdapterStatus;
  readonly createdAt: string;
  readonly auditHash: string;
}

// ---------------------------------------------------------------------------
// Eval
// ---------------------------------------------------------------------------

export type PromotionDecision = 'promote' | 'rollback' | 'no-op';

export interface EvalRun {
  readonly id: string;
  readonly tenantId: string;
  readonly adapterId: string | null;
  readonly gauntletVersion: string;
  readonly wer: number;
  readonly per: number;
  readonly grammarScore: number;
  readonly terminologyScore: number;
  readonly mos: number | null;
  readonly decision: PromotionDecision;
  readonly ranAt: string;
  readonly auditHash: string;
}

export interface EvalDelta {
  readonly wer: number;
  readonly per: number;
  readonly grammar: number;
  readonly terminology: number;
}

// ---------------------------------------------------------------------------
// Gauntlet entry
// ---------------------------------------------------------------------------

export type UtteranceCategory =
  | 'regulatory'
  | 'dimensional'
  | 'governance'
  | 'dialect'
  | 'environment';

export interface GauntletEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly lang: LanguageTag;
  readonly prompt: string;
  readonly expectedText: string;
  readonly expectedIntent: string | null;
  readonly domain: string | null;
  readonly dialect: Dialect;
  readonly category: UtteranceCategory;
  readonly auditHash: string;
}

// ---------------------------------------------------------------------------
// Promotion / decision thresholds
// ---------------------------------------------------------------------------

export interface PromotionThresholds {
  /** Negative ΔWER ≤ this counts as improvement (e.g. -0.005). */
  readonly werImprovementCeiling: number;
  /** Positive ΔWER ≥ this triggers rollback (e.g. +0.010). */
  readonly werRegressionFloor: number;
  readonly perImprovementCeiling: number;
  readonly perRegressionFloor: number;
  readonly grammarImprovementCeiling: number;
  readonly grammarRegressionFloor: number;
  readonly terminologyImprovementCeiling: number;
  readonly terminologyRegressionFloor: number;
  /** Minimum entries per dialect bucket for significance. */
  readonly minEntriesPerDialect: number;
}

export const DEFAULT_PROMOTION_THRESHOLDS: PromotionThresholds = Object.freeze({
  werImprovementCeiling: -0.005,
  werRegressionFloor: 0.01,
  perImprovementCeiling: -0.003,
  perRegressionFloor: 0.006,
  grammarImprovementCeiling: 0.02,
  grammarRegressionFloor: -0.03,
  terminologyImprovementCeiling: 0.02,
  terminologyRegressionFloor: -0.03,
  minEntriesPerDialect: 30,
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class LanguageSelfImproveError extends Error {
  public readonly code:
    | 'INVALID_INPUT'
    | 'PORT_FAILURE'
    | 'CONSENT_DENIED'
    | 'INTERNAL';

  constructor(
    message: string,
    code:
      | 'INVALID_INPUT'
      | 'PORT_FAILURE'
      | 'CONSENT_DENIED'
      | 'INTERNAL',
  ) {
    super(message);
    this.name = 'LanguageSelfImproveError';
    this.code = code;
  }
}
