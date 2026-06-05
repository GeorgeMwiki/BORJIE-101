/**
 * Blind-review pipeline — type contracts.
 *
 * Implements the M5 milestone: a Turing-style indistinguishability test
 * for marginal mining decisions (licence / royalty / payout). N senior
 * officers blind-classify each of ~100 anonymized rationales as
 * AI-authored or human-authored. The bar is `accuracy <= 0.55` — at or
 * below 55 percent reviewer accuracy is statistically indistinguishable
 * from chance at n=100 (95 percent CI ~+/-9.8 percentage points), which
 * we treat as "the AI is judged at parity with the senior officer."
 *
 * Ported from LITFIN `src/core/security/blind-review`, re-skinned from
 * lending credit decisions (five Cs) to mining decisions.
 *
 * Citations (2024-2026):
 *   - ReConcile (Chen et al, ACL 2024) round-table multi-agent debate.
 *   - Hu et al ICML 2025, "Theory of Mind Benchmarks are Broken for LLMs".
 *   - AGENCYBENCH 2025 long-horizon coherence.
 *   - Anthropic Constitutional AI (Bai et al, 2022) perspective rotation.
 */

export type DecisionAuthor = 'ai' | 'human';

export type MiningDecisionDomain = 'licence' | 'royalty' | 'payout';

export type MiningDecisionOutcome =
  | 'approve'
  | 'reject'
  | 'request_more_info';

/**
 * Structured snapshot of the factors a mining decision weighed, PII
 * stripped. Replaces LITFIN's five-Cs credit snapshot. Free-form object
 * so the reviewer UI can render whatever fields a domain produced.
 */
export type MiningDecisionSnapshot = Readonly<Record<string, unknown>>;

export interface MarginalDecisionRecord {
  readonly id: string;
  /** Anonymised application / case id. */
  readonly caseId: string;
  readonly domain: MiningDecisionDomain;
  readonly decision: MiningDecisionOutcome;
  /** Owner-facing rationale, anonymised. */
  readonly rationale: string;
  /** Structured decision snapshot. PII stripped. */
  readonly snapshot: MiningDecisionSnapshot;
  /** Ground truth, hidden from reviewers. */
  readonly author: DecisionAuthor;
  /** ISO year only, to prevent reverse-identification. */
  readonly decidedAtIsoYear: string;
  /** Broad buckets to prevent reverse-id. */
  readonly mineralBucket: string;
  readonly regionBucket: string;
}

export interface ReviewerAssignment {
  readonly reviewerId: string;
  readonly recordIds: ReadonlyArray<string>;
}

export interface ReviewerVerdict {
  readonly reviewerId: string;
  readonly recordId: string;
  readonly guess: DecisionAuthor;
  readonly confidence: number; // 0..1
  readonly rationale?: string;
}

export interface BlindReviewDataset {
  readonly id: string;
  readonly createdAtMs: number;
  readonly aiRecords: ReadonlyArray<MarginalDecisionRecord>;
  readonly humanRecords: ReadonlyArray<MarginalDecisionRecord>;
  readonly totalSize: number;
}

export interface ConfusionMatrix {
  readonly aiCorrectlyIdentified: number;
  readonly humanCorrectlyIdentified: number;
  readonly aiMisidentifiedAsHuman: number;
  readonly humanMisidentifiedAsAi: number;
}

export interface BlindReviewReport {
  readonly datasetId: string;
  readonly totalReviews: number;
  readonly accuracy: number;
  readonly indistinguishable: boolean;
  readonly perReviewer: ReadonlyArray<{
    readonly reviewerId: string;
    readonly accuracy: number;
    readonly nReviews: number;
  }>;
  readonly confusionMatrix: ConfusionMatrix;
  readonly markdown: string;
  readonly passed: boolean;
}

/** Default indistinguishability bar (M5). */
export const INDISTINGUISHABILITY_BAR = 0.55;

/** Default deterministic seed for replayable runs. */
export const DEFAULT_SEED = 20260603;
