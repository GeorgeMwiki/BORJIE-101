/**
 * `@borjie/post-training-rlvr` — public types.
 *
 * Companion to Docs/DESIGN/RLVR_POST_TRAINING_SPEC.md. Verifiable-
 * reward orchestration for Mr. Mwikila post-training. No mutation —
 * every public type is `readonly` end-to-end. Numeric rewards live in
 * `[0, 1]`; verifiers MUST clamp before returning.
 */

// ────────────────────────────────────────────────────────────────────────
// Trace
// ────────────────────────────────────────────────────────────────────────

/**
 * A tool call inside a trace. The `args` field is the canonical
 * (audit-safe) projection of the LLM's tool invocation.
 */
export interface RlvrToolCall {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly result: Readonly<Record<string, unknown>> | null;
}

/**
 * One captured Mr. Mwikila trace. Synthetic traces (used in tests)
 * carry `synthetic: true` in `metadata`; the production runner refuses
 * to advance any trace with this flag set.
 */
export interface RlvrTrace {
  readonly id: string;
  readonly runId: string;
  readonly tenantId: string;
  readonly prompt: string;
  readonly completion: string;
  readonly toolCalls: ReadonlyArray<RlvrToolCall>;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly capturedAt: string;
}

// ────────────────────────────────────────────────────────────────────────
// Run
// ────────────────────────────────────────────────────────────────────────

export type RlvrRunStatus =
  | 'pending'
  | 'running'
  | 'verifying'
  | 'curating'
  | 'redacting'
  | 'ready_for_handoff'
  | 'handed_off'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type RlvrRunKind =
  | 'tra_filings'
  | 'royalty_audits'
  | 'brand_compliance'
  | 'citation_grounding'
  | 'mixed'
  | 'synthetic_test';

export interface RlvrRun {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: RlvrRunKind;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly status: RlvrRunStatus;
  /** Names of verifiers this run consults. */
  readonly verifierSet: ReadonlyArray<string>;
  readonly auditHash: string;
  readonly prevHash: string;
}

// ────────────────────────────────────────────────────────────────────────
// Verifier
// ────────────────────────────────────────────────────────────────────────

export type Verdict = 'pass' | 'fail' | 'partial' | 'skip';

export interface VerificationResult {
  readonly verifierName: string;
  readonly verdict: Verdict;
  /** Scalar reward in `[0, 1]`. */
  readonly reward: number;
  readonly evidence: Readonly<Record<string, unknown>>;
  /** Verifier-self-reported confidence in its own verdict. `[0, 1]`. */
  readonly confidence: number;
}

/**
 * The verifier contract. `applies` short-circuits non-relevant
 * verifiers; `verify` is invoked only when `applies` returns true.
 */
export interface Verifier {
  readonly name: string;
  readonly version: string;
  applies(trace: RlvrTrace): boolean;
  verify(trace: RlvrTrace): Promise<VerificationResult>;
}

// ────────────────────────────────────────────────────────────────────────
// Reward shape
// ────────────────────────────────────────────────────────────────────────

/**
 * Aggregate reward across all verifiers for a single trace. Each
 * per-verifier verdict is preserved alongside the aggregate so a
 * downstream training run can choose to supervise on a specific
 * verifier rather than the aggregate.
 */
export interface RewardShape {
  readonly traceId: string;
  readonly perVerifier: ReadonlyArray<VerificationResult>;
  /** Weighted sum across `pass`/`fail`/`partial` (skip excluded). */
  readonly aggregate: number;
  /** Sum of weights actually contributing — `skip` rows do not count. */
  readonly effectiveWeight: number;
  /** True when at least one verifier emitted `fail`. */
  readonly anyFail: boolean;
}

export interface RewardWeights {
  readonly [verifierName: string]: number;
}

// ────────────────────────────────────────────────────────────────────────
// Curation
// ────────────────────────────────────────────────────────────────────────

export interface CuratedExample {
  readonly id: string;
  readonly runId: string;
  readonly traceId: string;
  readonly tenantId: string;
  readonly prompt: Readonly<Record<string, unknown>>;
  readonly completion: Readonly<Record<string, unknown>>;
  readonly reward: number;
  readonly included: boolean;
  readonly exclusionReason: string | null;
  readonly curatedAt: string;
  readonly auditHash: string;
}

export type ExclusionReason =
  | 'reward_below_floor'
  | 'duplicate_prompt'
  | 'epsilon_exhausted'
  | 'tier_2_critical_no_founder'
  | 'scope_mismatch'
  | 'synthetic_in_production'
  | 'any_fail'
  | 'no_passing_verifier';

// ────────────────────────────────────────────────────────────────────────
// Redaction
// ────────────────────────────────────────────────────────────────────────

export interface RedactionConfig {
  /** Salt used in `sha256(tenantId:fieldPath:value)`. */
  readonly tenantId: string;
  /** Field paths that stay in plaintext. */
  readonly allowlist: ReadonlyArray<string>;
}

// ────────────────────────────────────────────────────────────────────────
// Curator config
// ────────────────────────────────────────────────────────────────────────

export interface CuratorConfig {
  readonly rewardFloor: number;
  readonly dedupe: boolean;
  readonly includeFailures: boolean;
}

export const DEFAULT_CURATOR_CONFIG: CuratorConfig = Object.freeze({
  rewardFloor: 0.5,
  dedupe: true,
  includeFailures: false,
});
