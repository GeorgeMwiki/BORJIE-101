/**
 * `@borjie/meta-learning-conductor` — shared types.
 *
 * Wave SELFIMPROVE. See Docs/DESIGN/SELF_IMPROVE_AND_DP_FEDERATION_SPEC.md.
 *
 * No I/O, no global state — only types. The runner depends on three
 * injected ports and structural interfaces; the catalogue port is
 * structural so we never import `@borjie/capability-catalogue`'s
 * concrete types.
 */

// ---------------------------------------------------------------------------
// Decisions + run status
// ---------------------------------------------------------------------------

export type Decision = 'promote' | 'demote' | 'no-op' | 'rollback';

export type RunStatus = 'scheduled' | 'running' | 'succeeded' | 'failed';

// ---------------------------------------------------------------------------
// Examples curated by the conductor
// ---------------------------------------------------------------------------

/**
 * One curated training example. The conductor never sees the raw
 * trace — the curator hands back shaped examples already redacted +
 * deduplicated.
 */
export interface Example {
  /** UUID. */
  readonly id: string;
  readonly tenantId: string;
  /** FK into the run. */
  readonly metaRunId: string;
  /** JSON payload — input to the policy under test. */
  readonly prompt: Readonly<Record<string, unknown>>;
  /** JSON payload — the policy's response. */
  readonly completion: Readonly<Record<string, unknown>>;
  /** Reward in [-1, 1]. */
  readonly reward: number;
  /** False if curator filtered the example out post-shaping. */
  readonly included: boolean;
  readonly auditHash: string;
}

// ---------------------------------------------------------------------------
// Meta-learning runs
// ---------------------------------------------------------------------------

/**
 * One conductor run. status moves
 * `scheduled → running → succeeded | failed`; decision is set when
 * status reaches `succeeded`.
 */
export interface MetaLearningRun {
  readonly id: string;
  readonly tenantId: string;
  readonly startedAt: string; // ISO
  readonly endedAt: string | null;
  readonly status: RunStatus;
  readonly capabilityId: string;
  readonly examplesCount: number;
  readonly evalMetricBefore: number | null;
  readonly evalMetricAfter: number | null;
  readonly decision: Decision | null;
  readonly auditHash: string;
  readonly prevHash: string | null;
}

// ---------------------------------------------------------------------------
// Capability-catalogue port (STRUCTURAL — we never import the package)
// ---------------------------------------------------------------------------

/**
 * Minimal structural shape the conductor needs from the capability
 * catalogue. By depending on a structural interface (and NOT on
 * `@borjie/capability-catalogue`'s exported types) we keep that
 * package free to refactor.
 */
export interface CapabilityCataloguePort {
  /** Look up the current rolling-metric for a capability. */
  readonly getCurrentMetric: (
    tenantId: string,
    capabilityId: string,
  ) => Promise<number>;

  /**
   * Apply the decision to the catalogue. Implementations are expected
   * to be idempotent + audit-chained.
   */
  readonly applyDecision: (
    args: Readonly<{
      tenantId: string;
      capabilityId: string;
      decision: Decision;
      runId: string;
      evalBefore: number | null;
      evalAfter: number | null;
    }>,
  ) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Trace source port
// ---------------------------------------------------------------------------

/**
 * Raw trace shape pulled from `decision_traces`. The conductor never
 * stores these directly — the curator shapes them into `Example`.
 */
export interface RawTrace {
  readonly id: string;
  readonly tenantId: string;
  readonly capabilityId: string;
  readonly prompt: Readonly<Record<string, unknown>>;
  readonly completion: Readonly<Record<string, unknown>>;
  /** Cognitive-engine reward signal (base). */
  readonly baseReward: number;
  /** [0, 1] — how broadly the trace exercises the capability surface. */
  readonly coverageScore: number;
  /** [0, 1] — confidence the trace was high quality. */
  readonly confidenceScore: number;
  /** [0, 1] — fraction of fields successfully redacted. */
  readonly redactionPenalty: number;
  readonly occurredAt: string;
}

export interface TraceSourcePort {
  readonly pull: (
    args: Readonly<{
      tenantId: string;
      capabilityId: string;
      windowSinceMs: number;
      limit: number;
    }>,
  ) => Promise<ReadonlyArray<RawTrace>>;
}

// ---------------------------------------------------------------------------
// PII redactor port
// ---------------------------------------------------------------------------

export interface PIIRedactor {
  /** Redacts any free-text patterns; pure function. */
  readonly redact: (value: unknown) => unknown;
}

// ---------------------------------------------------------------------------
// Evaluator port
// ---------------------------------------------------------------------------

export interface EvaluatorPort {
  /**
   * Returns a scalar metric in [0, 1] for the named policy on the
   * tenant's held-out eval set.
   */
  readonly score: (
    args: Readonly<{
      tenantId: string;
      capabilityId: string;
      /** 'before' = current live policy; 'after' = proposed. */
      side: 'before' | 'after';
    }>,
  ) => Promise<number>;
}

// ---------------------------------------------------------------------------
// Audit chain port
// ---------------------------------------------------------------------------

export interface AuditChainPort {
  /** Compute the row hash given the prev hash + canonical payload. */
  readonly hash: (
    prevHash: string | null,
    payload: Readonly<Record<string, unknown>>,
  ) => string;
}

// ---------------------------------------------------------------------------
// Clock / uuid ports
// ---------------------------------------------------------------------------

export interface ClockPort {
  readonly nowIso: () => string;
  readonly nowMs: () => number;
}

export interface UuidPort {
  readonly next: () => string;
}

// ---------------------------------------------------------------------------
// Curator config
// ---------------------------------------------------------------------------

export interface RewardShapingConfig {
  /** Weight on base reward. */
  readonly alpha: number;
  /** Weight on coverage. */
  readonly beta: number;
  /** Penalty multiplier on redaction-failure. */
  readonly gamma: number;
  /** Minimum reward — examples below this are excluded. */
  readonly minReward: number;
  /** Maximum redaction penalty — above this excluded. */
  readonly maxRedactionPenalty: number;
}

export const DEFAULT_REWARD_SHAPING: RewardShapingConfig = Object.freeze({
  alpha: 1.0,
  beta: 0.5,
  gamma: 0.5,
  minReward: -1.0,
  maxRedactionPenalty: 0.5,
});

// ---------------------------------------------------------------------------
// Decider config
// ---------------------------------------------------------------------------

export interface PromotionDeciderConfig {
  /** Minimum delta to promote. */
  readonly promoteThreshold: number;
  /** Minimum negative delta to demote. */
  readonly demoteThreshold: number;
}

export const DEFAULT_DECIDER_CONFIG: PromotionDeciderConfig = Object.freeze({
  promoteThreshold: 0.02,
  demoteThreshold: 0.02,
});

// ---------------------------------------------------------------------------
// Logger port — composes with @borjie/observability::createLogger.
// ---------------------------------------------------------------------------

export interface Logger {
  readonly debug: (message: string, meta?: Record<string, unknown>) => void;
  readonly info: (message: string, meta?: Record<string, unknown>) => void;
  readonly warn: (message: string, meta?: Record<string, unknown>) => void;
  readonly error: (message: string, meta?: Record<string, unknown>) => void;
}
