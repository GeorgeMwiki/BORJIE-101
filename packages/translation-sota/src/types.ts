/**
 * `@borjie/translation-sota` — public type surface.
 *
 * Wave 19I. Mirrors the 3-table schema introduced by migration
 * `0050_translation_sota.sql`:
 *
 *   - TranslationRun                  — a row in `translation_runs`.
 *   - GlossaryEntry                   — a row in
 *                                       `translation_glossary_overrides`
 *                                       (plus the bundled mining seed +
 *                                       Wave-19H domain glossary).
 *   - TranslationEval                 — a row in `translation_evals`.
 *
 * Plus the typed segments + register tags + provider port the runner
 * walks through.
 *
 * Spec: Docs/DESIGN/TRANSLATION_SOTA_SPEC.md. Persona: Mr. Mwikila.
 */

// ---------------------------------------------------------------------------
// Language codes
// ---------------------------------------------------------------------------

/** ISO-639-1 language codes supported by the translation runner. */
export type LanguageCode = 'sw' | 'en';

/** Stable provider identifiers. Matches the SQL CHECK constraint. */
export type ProviderId = 'claude-opus-4-7' | 'gemini-2-5-pro' | 'nllb-200';

/** Glossary entry domain. Matches the SQL CHECK constraint. */
export type GlossaryDomain =
  | 'mining'
  | 'regulatory'
  | 'financial'
  | 'safety'
  | 'general';

/** Register / formality tag. Matches the SQL CHECK constraint. */
export type RegisterLevel = 'formal' | 'neutral' | 'casual';

/** Eval judge id. Matches the SQL CHECK constraint. */
export type JudgeId =
  | 'bleu'
  | 'chrf'
  | 'comet'
  | 'terminology-adherence'
  | 'human';

// ---------------------------------------------------------------------------
// Translation request + result
// ---------------------------------------------------------------------------

export interface TranslationRequest {
  readonly tenantId: string;
  readonly sourceLang: LanguageCode;
  readonly targetLang: LanguageCode;
  readonly sourceText: string;
  /**
   * Optional caller-provided register hint. When omitted the register
   * mapper auto-detects from honorific lexicon presence.
   */
  readonly register?: RegisterLevel;
  /**
   * Optional reference translation. When present, BLEU / chrF /
   * COMET are computed against it. When absent the run skips the
   * lexical scores and only reports terminology-adherence.
   */
  readonly reference?: string;
}

export interface TranslationResult {
  readonly tenantId: string;
  readonly runId: string;
  readonly sourceLang: LanguageCode;
  readonly targetLang: LanguageCode;
  readonly sourceText: string;
  readonly targetText: string;
  readonly provider: ProviderId;
  readonly register: RegisterTag;
  readonly glossaryTermsUsed: ReadonlyArray<GlossaryEntry>;
  readonly codeSwitchSegments: ReadonlyArray<CodeSwitchSegment>;
  readonly bleu: number | null;
  readonly chrf: number | null;
  readonly terminologyAdherence: number;
  readonly latencyMs: number;
  readonly costUsdCents: number;
  readonly auditHash: string;
  readonly prevHash: string;
  readonly createdAt: Date;
  /**
   * Demotion history when tier 1 / tier 2 failed and we fell through.
   * Each entry records the failed provider + reason.
   */
  readonly demotions: ReadonlyArray<ProviderDemotion>;
}

export interface ProviderDemotion {
  readonly from: ProviderId;
  readonly to: ProviderId;
  readonly reason: 'unhealthy' | 'glossary-violation' | 'latency-budget' | 'error';
  readonly at: Date;
}

// ---------------------------------------------------------------------------
// Glossary entries + glossary index
// ---------------------------------------------------------------------------

export interface GlossaryEntry {
  readonly srcTerm: string;
  readonly srcLang: LanguageCode;
  readonly targetTerm: string;
  readonly targetLang: LanguageCode;
  readonly domain: GlossaryDomain;
  readonly register: RegisterLevel;
  readonly sourceUrl?: string;
  /** Marks the term as a brand or proper noun that must NEVER be translated. */
  readonly brand?: boolean;
}

/**
 * A merged glossary view — bundled mining seed + Wave-19H domain
 * glossary + tenant overrides — keyed by canonical source term.
 */
export interface Glossary {
  /** All entries in priority order: tenant overrides come first. */
  readonly entries: ReadonlyArray<GlossaryEntry>;
  /**
   * Lookup: lowercased source term in the given source language → the
   * matching GlossaryEntry. The first matching entry (priority-
   * ordered) wins.
   */
  readonly index: ReadonlyMap<string, GlossaryEntry>;
}

// ---------------------------------------------------------------------------
// Code-switching segmenter
// ---------------------------------------------------------------------------

export type CodeSwitchTag =
  | 'src'
  | 'tgt'
  | 'brand'
  | 'proper'
  | 'number'
  | 'placeholder';

export interface CodeSwitchSegment {
  readonly text: string;
  readonly tag: CodeSwitchTag;
  /** Byte offset within the source text. */
  readonly startByte: number;
  /** Byte offset (exclusive) within the source text. */
  readonly endByte: number;
}

// ---------------------------------------------------------------------------
// Register tagging
// ---------------------------------------------------------------------------

export interface RegisterTag {
  readonly level: RegisterLevel;
  /** Honorific token detected in source, if any. */
  readonly honorific: string | undefined;
}

// ---------------------------------------------------------------------------
// Provider port — caller injects the actual model call
// ---------------------------------------------------------------------------

export interface ProviderTranslateRequest {
  readonly sourceLang: LanguageCode;
  readonly targetLang: LanguageCode;
  /**
   * The placeholder-laced source text — domain terms have already been
   * substituted by the term-locker pass.
   */
  readonly sourceText: string;
  /** Placeholder tokens that the provider must preserve verbatim. */
  readonly placeholders: ReadonlyArray<string>;
  /** Detected register; the provider may use it to shape formality. */
  readonly register: RegisterTag;
}

export interface ProviderTranslateResult {
  readonly targetText: string;
  readonly latencyMs: number;
  readonly costUsdCents: number;
}

/**
 * The translation provider port — Claude Opus / Gemini / NLLB all
 * implement this. The runner orchestrates the 3-tier fallback by
 * walking down a `readonly ProviderPort[]` in priority order.
 */
export interface ProviderPort {
  readonly id: ProviderId;
  translate(req: ProviderTranslateRequest): Promise<ProviderTranslateResult>;
  /** Returns `true` if the provider is currently healthy and reachable. */
  isHealthy(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Eval scoring
// ---------------------------------------------------------------------------

export interface TranslationEval {
  readonly id: string;
  readonly tenantId: string;
  readonly runId: string;
  readonly judge: JudgeId;
  readonly score: number;
  readonly rubric: Readonly<Record<string, unknown>>;
  readonly judgedAt: Date;
  readonly auditHash: string;
}

/**
 * Optional COMET port — the caller wires in a self-hosted COMET-22 or
 * COMET-Kiwi service. When undefined the runner skips COMET.
 */
export interface ComputeCometPort {
  score(input: {
    readonly source: string;
    readonly reference: string | undefined;
    readonly hypothesis: string;
    readonly sourceLang: LanguageCode;
    readonly targetLang: LanguageCode;
  }): Promise<number>;
}

// ---------------------------------------------------------------------------
// Glossary port (for Wave-19H Swahili linguistics interop)
// ---------------------------------------------------------------------------

/**
 * Domain glossary port — when wired up, the glossary manager merges
 * the entries returned by this port on top of the bundled mining
 * seed. The Wave-19H Swahili linguistics package implements this;
 * absent that, the manager runs on the seed alone.
 */
export interface DomainGlossaryPort {
  listEntries(): Promise<ReadonlyArray<GlossaryEntry>>;
}

// ---------------------------------------------------------------------------
// Repository contracts
// ---------------------------------------------------------------------------

export interface TranslationRunRepository {
  insert(input: {
    readonly tenantId: string;
    readonly sourceLang: LanguageCode;
    readonly targetLang: LanguageCode;
    readonly sourceText: string;
    readonly targetText: string;
    readonly provider: ProviderId;
    readonly glossaryTermsUsed: ReadonlyArray<GlossaryEntry>;
    readonly codeSwitchSegments: ReadonlyArray<CodeSwitchSegment>;
    readonly bleu: number | null;
    readonly chrf: number | null;
    readonly terminologyAdherence: number;
    readonly latencyMs: number;
    readonly costUsdCents: number;
  }): Promise<{
    readonly id: string;
    readonly auditHash: string;
    readonly prevHash: string;
    readonly createdAt: Date;
  }>;

  findById(tenantId: string, id: string): Promise<TranslationResult | null>;

  listRecentForTenant(
    tenantId: string,
    limit: number,
  ): Promise<ReadonlyArray<TranslationResult>>;
}

export interface GlossaryOverrideRepository {
  upsert(entry: GlossaryEntry & { readonly tenantId: string }): Promise<void>;
  listForTenant(tenantId: string): Promise<ReadonlyArray<GlossaryEntry>>;
  delete(input: {
    readonly tenantId: string;
    readonly srcTerm: string;
    readonly srcLang: LanguageCode;
    readonly targetLang: LanguageCode;
    readonly register: RegisterLevel;
  }): Promise<void>;
}

export interface TranslationEvalRepository {
  insert(input: {
    readonly tenantId: string;
    readonly runId: string;
    readonly judge: JudgeId;
    readonly score: number;
    readonly rubric: Readonly<Record<string, unknown>>;
  }): Promise<TranslationEval>;

  listForRun(
    tenantId: string,
    runId: string,
  ): Promise<ReadonlyArray<TranslationEval>>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TRANSLATION_CONSTANTS = Object.freeze({
  /** Latency budget for tier 1 (Claude Opus). */
  TIER1_LATENCY_BUDGET_MS: 8_000,
  /** Latency budget for tier 2 (Gemini 2.5 Pro). */
  TIER2_LATENCY_BUDGET_MS: 8_000,
  /** Latency budget for tier 3 (NLLB self-host). */
  TIER3_LATENCY_BUDGET_MS: 15_000,
  /**
   * Required glossary adherence ratio to ship a run without demoting.
   * Default 0.99 — i.e. 99 % of glossary terms must survive verbatim.
   */
  GLOSSARY_ADHERENCE_FLOOR: 0.99,
  /** Placeholder format: `<<G:NNNN>>`. */
  PLACEHOLDER_REGEX: /<<G:(\d{4})>>/g,
});
