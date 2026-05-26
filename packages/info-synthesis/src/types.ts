/**
 * `@borjie/info-synthesis` — public type surface.
 *
 * Wave M7. Mirrors the 2-table schema introduced by migration
 * `0038_info_synthesis.sql`:
 *
 *   - SynthRun    — a row in `synth_runs` (pipeline invocation).
 *   - SynthOutput — a row in `synth_outputs` (emitted synthesis).
 *
 * Plus the typed pipeline-stage records (Chunk, ScoredChunk, Cluster,
 * ReconciledCluster, Citation, Disagreement, CalibratedScore) the
 * diorize pipeline walks through.
 *
 * Spec: Docs/DESIGN/INFORMATION_SYNTHESIS_SOTA_SPEC.md.
 */

// ---------------------------------------------------------------------------
// Synthesis lifecycle status — matches the SQL CHECK constraint
// ---------------------------------------------------------------------------

export type SynthRunStatus = 'pending' | 'running' | 'succeeded' | 'failed';

// ---------------------------------------------------------------------------
// Corpus inputs — the raw material the synthesizer is asked to digest
// ---------------------------------------------------------------------------

/**
 * A single artifact in the input corpus. The synthesizer treats every
 * artifact uniformly: journal entries, research results, ingested
 * documents, tacit-knowledge transcripts all reduce to this shape.
 */
export interface CorpusArtifact {
  readonly id: string;
  readonly source: string;
  /** ISO 8601 timestamp; if unknown, undefined. */
  readonly publishedAt?: string;
  readonly title?: string;
  readonly text: string;
  /** Provenance score (0..1) — caller-assigned reliability prior. */
  readonly reliability?: number;
}

// ---------------------------------------------------------------------------
// Synthesis request + output
// ---------------------------------------------------------------------------

export interface SynthRequest {
  readonly tenantId: string;
  readonly query: string;
  readonly corpus: ReadonlyArray<CorpusArtifact>;
  /** Override chunk size budget (default 400 words). */
  readonly chunkWordBudget?: number;
  /** Maximum clusters to surface (default 5). */
  readonly maxClusters?: number;
}

export interface SynthOutput {
  readonly id: string;
  readonly synthRunId: string;
  readonly tenantId: string;
  readonly output: string;
  readonly citations: ReadonlyArray<Citation>;
  readonly calibratedConfidence: number;
  readonly disagreements: ReadonlyArray<Disagreement>;
  readonly auditHash: string;
  readonly emittedAt: Date;
}

export interface SynthRun {
  readonly id: string;
  readonly tenantId: string;
  readonly query: string;
  readonly corpusIds: ReadonlyArray<string>;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly status: SynthRunStatus;
  readonly auditHash: string;
  readonly prevHash: string;
}

// ---------------------------------------------------------------------------
// Pipeline stage records
// ---------------------------------------------------------------------------

/** Output of the chunker stage — one chunk per ~400-word window. */
export interface Chunk {
  readonly id: string;
  readonly artifactId: string;
  readonly text: string;
  readonly wordCount: number;
  /** 0-based index within the source artifact. */
  readonly seq: number;
}

/** Output of the scorer stage — chunks with weighted relevance + quality. */
export interface ScoredChunk extends Chunk {
  readonly relevance: number;
  readonly quality: number;
  readonly recencyDecay: number;
  /** Overall combined score 0..1 — drives cluster selection. */
  readonly score: number;
}

/** Output of the clusterer stage — chunks grouped by topical proximity. */
export interface Cluster {
  readonly id: string;
  readonly topic: string;
  readonly chunkIds: ReadonlyArray<string>;
  readonly avgScore: number;
}

/** Output of the reconciler stage — clusters with internal contradictions resolved. */
export interface ReconciledCluster extends Cluster {
  /** Non-empty when the cluster contained contradicting claims. */
  readonly contradictions: ReadonlyArray<Contradiction>;
  /** Normalised summary text the writer downstream uses verbatim. */
  readonly summary: string;
}

export interface Contradiction {
  readonly claim: string;
  readonly counterClaim: string;
  readonly supportingChunkIds: ReadonlyArray<string>;
  readonly counterChunkIds: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Citation + disagreement contracts
// ---------------------------------------------------------------------------

/**
 * A per-claim citation anchor. Links the rendered synthesis prose back
 * to the supporting chunks + their source artifacts. Mirrors the
 * SpanCitation contract from research-orchestrator + cognitive-engine.
 */
export interface Citation {
  readonly claimSpan: string;
  readonly chunkId: string;
  readonly artifactId: string;
  readonly source: string;
  readonly confidence: number;
}

/**
 * A surfaced disagreement — a topic on which the corpus disagrees.
 * Never silently averaged; rendered as a separate section in the
 * output by the writer.
 */
export interface Disagreement {
  readonly topic: string;
  readonly positions: ReadonlyArray<DisagreementPosition>;
}

export interface DisagreementPosition {
  readonly stance: string;
  readonly sources: ReadonlyArray<string>;
  readonly chunkIds: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Calibrated score — Brier/ECE-adjusted confidence
// ---------------------------------------------------------------------------

/**
 * The calibrator's output. Wraps a raw confidence (0..1) with the
 * adjustment applied (Brier-score-driven shrinkage when sources
 * disagree, low quality, or are stale) plus a confidence interval.
 */
export interface CalibratedScore {
  readonly raw: number;
  readonly calibrated: number;
  readonly interval: { readonly lower: number; readonly upper: number };
  readonly factors: ReadonlyArray<CalibrationFactor>;
}

export interface CalibrationFactor {
  readonly name: string;
  readonly delta: number;
  readonly description: string;
}

// ---------------------------------------------------------------------------
// Writer / LLM port — caller injects the actual model call
// ---------------------------------------------------------------------------

export interface WriterRequest {
  readonly query: string;
  readonly clusters: ReadonlyArray<ReconciledCluster>;
  readonly disagreements: ReadonlyArray<Disagreement>;
  readonly tenantId: string;
}

/**
 * Port the writer stage calls — the caller injects the actual LLM
 * binding. Tests can pass a deterministic stub.
 */
export type WriterPort = (req: WriterRequest) => Promise<string>;

// ---------------------------------------------------------------------------
// Repository contracts
// ---------------------------------------------------------------------------

export interface SynthRunRepository {
  start(input: {
    readonly tenantId: string;
    readonly query: string;
    readonly corpusIds: ReadonlyArray<string>;
  }): Promise<SynthRun>;
  markRunning(tenantId: string, id: string): Promise<void>;
  markSucceeded(tenantId: string, id: string): Promise<void>;
  markFailed(tenantId: string, id: string): Promise<void>;
  findById(tenantId: string, id: string): Promise<SynthRun | null>;
  listRecentForTenant(
    tenantId: string,
    limit: number,
  ): Promise<ReadonlyArray<SynthRun>>;
}

export interface SynthOutputRepository {
  insert(input: {
    readonly synthRunId: string;
    readonly tenantId: string;
    readonly output: string;
    readonly citations: ReadonlyArray<Citation>;
    readonly calibratedConfidence: number;
    readonly disagreements: ReadonlyArray<Disagreement>;
  }): Promise<SynthOutput>;
  findByRun(
    tenantId: string,
    synthRunId: string,
  ): Promise<ReadonlyArray<SynthOutput>>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const INFO_SYNTHESIS_CONSTANTS = Object.freeze({
  DEFAULT_CHUNK_WORD_BUDGET: 400,
  DEFAULT_MAX_CLUSTERS: 5,
  /** Recency-decay half-life in days. */
  RECENCY_HALFLIFE_DAYS: 180,
  /** Minimum score for a chunk to enter clustering. */
  MIN_SCORE_FOR_CLUSTERING: 0.1,
  /**
   * When a cluster's contradictions outweigh its supports, the
   * cluster is upgraded to a Disagreement instead of a fact.
   */
  CONTRADICTION_RATIO_THRESHOLD: 0.5,
});
