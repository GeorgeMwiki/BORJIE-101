/**
 * Reflection + consolidation cycle — types.
 *
 * The consolidation cycle is the brain's "sleep" pass — periodically
 * (typically nightly + weekly) it reads recent episodic memory, distils
 * semantic facts and reflective digests, and detects procedural
 * patterns. It then prunes expired episodic rows and decays semantic
 * confidence. Mirrors LITFIN's sleep cycle.
 *
 * The four memory ports already exist; this module ONLY orchestrates
 * the cycle above them.
 */

import type {
  EpisodicMemoryPort,
  ProceduralMemoryPort,
  ReflectiveMemoryPort,
  ReflectivePeriodKind,
  ReflectiveTopicCount,
  SemanticMemoryPort,
} from '../memory/index.js';

// ─────────────────────────────────────────────────────────────────────
// Judge port — small Haiku-shaped LLM call. Provider-agnostic so the
// cycle can be unit tested with vi.fn() and prod-wired to the real
// Anthropic Haiku client.
// ─────────────────────────────────────────────────────────────────────

export interface ConsolidationJudgePort {
  /**
   * Run a one-shot judge call. Returns the model's raw text body. The
   * cycle parses + schema-validates it; the judge MUST NOT throw on
   * model-side failures (return empty string).
   */
  call(args: ConsolidationJudgeCallArgs): Promise<string>;
}

export interface ConsolidationJudgeCallArgs {
  readonly system: string;
  readonly userPrompt: string;
  readonly maxTokens?: number;
}

// ─────────────────────────────────────────────────────────────────────
// Scope — whose memory to consolidate.
// ─────────────────────────────────────────────────────────────────────

export interface ConsolidationScope {
  readonly tenantId: string | null;
  readonly userId: string | null;
  readonly periodKind: ReflectivePeriodKind;
}

// ─────────────────────────────────────────────────────────────────────
// Config — knobs the cycle exposes.
// ─────────────────────────────────────────────────────────────────────

export interface ConsolidationConfig {
  /**
   * How many days of episodic history to read for fact extraction.
   * Daily run typically uses 1; weekly run uses 7.
   */
  readonly windowDays: number;
  /**
   * Cap on episodic entries fed into the judge. Protects token spend.
   */
  readonly maxEpisodicEntries: number;
  /**
   * Min confidence threshold for fact upserts (0..1).
   */
  readonly minFactConfidence: number;
  /**
   * Min repeat count for a tool sequence to qualify as a procedural
   * pattern. Default 2 → "happened twice in the window".
   */
  readonly minPatternRepeats: number;
  /**
   * Length of the rolling tool-sequence window for pattern detection.
   * Default 3 → "any 3-step sequence".
   */
  readonly patternWindowSize: number;
  /**
   * Daily decay rate fed to semantic.decay(). Default 0.005.
   */
  readonly decayPerDay: number;
  /**
   * Whether to call episodic.purgeExpired() this cycle. Default true.
   */
  readonly purgeExpired: boolean;
  /**
   * Whether to call semantic.decay() this cycle. Default true on
   * daily runs; off on weekly runs (already decayed by daily).
   */
  readonly applyDecay: boolean;
  /**
   * Reference 'now' for the cycle. Defaults to Date.now() at call
   * time; overridable for deterministic tests.
   */
  readonly now?: Date;
}

export const DEFAULT_CONSOLIDATION_CONFIG: ConsolidationConfig = {
  windowDays: 1,
  maxEpisodicEntries: 200,
  minFactConfidence: 0.4,
  minPatternRepeats: 2,
  patternWindowSize: 3,
  decayPerDay: 0.005,
  purgeExpired: true,
  applyDecay: true,
};

// ─────────────────────────────────────────────────────────────────────
// Deps — the orchestrator's injected ports + judge.
// ─────────────────────────────────────────────────────────────────────

export interface ConsolidationDeps {
  readonly episodic: EpisodicMemoryPort;
  readonly semantic: SemanticMemoryPort;
  readonly procedural: ProceduralMemoryPort;
  readonly reflective: ReflectiveMemoryPort;
  readonly judge: ConsolidationJudgePort;
  /**
   * Optional logger; defaults to console for warnings.
   */
  readonly logger?: ConsolidationLogger;
}

export interface ConsolidationLogger {
  warn(msg: string, meta?: Record<string, unknown>): void;
  info?(msg: string, meta?: Record<string, unknown>): void;
}

// ─────────────────────────────────────────────────────────────────────
// Judge output schemas — what the model is asked to return.
// ─────────────────────────────────────────────────────────────────────

export interface ExtractedFact {
  readonly key: string;
  readonly value: string;
  readonly confidence: number;
  readonly evidence: string;
}

export interface ReflectiveDigestPayload {
  readonly summary: string;
  readonly topTopics: ReadonlyArray<ReflectiveTopicCount>;
  readonly sentimentAvg: number | null;
  readonly actionItems: ReadonlyArray<string>;
}

// ─────────────────────────────────────────────────────────────────────
// Report — what `runConsolidationCycle` returns.
// ─────────────────────────────────────────────────────────────────────

export interface ConsolidationReport {
  readonly scope: ConsolidationScope;
  readonly episodicConsidered: number;
  readonly factsExtracted: number;
  readonly factsUpserted: number;
  readonly patternsRecorded: number;
  readonly digestsWritten: number;
  readonly expiredPurged: number;
  readonly decayedFacts: number;
  readonly errors: ReadonlyArray<string>;
  readonly startedAt: string;
  readonly finishedAt: string;
}
