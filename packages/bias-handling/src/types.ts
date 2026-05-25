/**
 * `@borjie/bias-handling` — public types.
 *
 * Extends `@borjie/fairness-eval` (individual / counterfactual) with
 * group fairness, mitigation, LLM bias benchmarks, drift monitoring,
 * subgroup discovery, and a per-jurisdiction protected-attribute map.
 *
 * Sources cited in `Docs/BIAS_HANDLING_SOTA_2026-05-25.md`.
 */

// ---------------------------------------------------------------------------
// Protected attribute model
// ---------------------------------------------------------------------------

/** ISO-3166-1 alpha-2 country / region code. */
export type Jurisdiction = string;

/** Application context that affects which protections apply. */
export type ProtectionContext =
  | 'housing'
  | 'credit'
  | 'employment'
  | 'generic';

/** A single protected attribute under a statute. */
export interface ProtectedAttribute {
  /** Stable id used in metrics + audit logs (e.g. 'race'). */
  readonly id: string;
  /** Human-readable label for UI / reports. */
  readonly label: string;
  /** Jurisdiction this protection comes from. */
  readonly jurisdiction: Jurisdiction;
  /** Statute citation for audit. */
  readonly citation: string;
  /** Contexts the protection applies to. */
  readonly contexts: ReadonlyArray<ProtectionContext>;
}

// ---------------------------------------------------------------------------
// Group fairness — input + output
// ---------------------------------------------------------------------------

/**
 * Per-instance row used by group-fairness metrics. Subject's predicted
 * binary outcome (0/1), true binary label (0/1, optional), score
 * ([0,1], optional, used for calibration), and the protected
 * attribute value.
 */
export interface FairnessRow {
  /** Value of the protected attribute for this row (e.g. 'female'). */
  readonly group: string;
  /** Model's binary prediction (1 = favourable outcome). */
  readonly prediction: 0 | 1;
  /** Ground-truth label, if known (1 = favourable). */
  readonly label?: 0 | 1;
  /** Optional model score in [0,1] — required by `calibrationWithinGroups`. */
  readonly score?: number;
}

/** Name of a group fairness metric we expose. */
export type BiasMetric =
  | 'demographic_parity'
  | 'disparate_impact'
  | 'equalized_odds'
  | 'equal_opportunity'
  | 'predictive_parity'
  | 'false_discovery_rate'
  | 'false_omission_rate'
  | 'calibration_within_groups'
  | 'statistical_parity_difference';

/**
 * Result of a single group fairness metric. `score` is the
 * metric-specific scalar (e.g. disparity ratio, KL divergence).
 * `disparities[group]` is the per-group contribution.
 */
export interface DisparityScore {
  readonly metric: BiasMetric;
  /** Single scalar: positive = unfair to unprivileged group. */
  readonly score: number;
  /** Per-group raw rate (P(Y_hat=1|A=g) or TPR(g) depending on metric). */
  readonly perGroup: Readonly<Record<string, number>>;
  /**
   * True if the metric breaches a default threshold. Caller may
   * override per-metric. The thresholds we use are documented in
   * `src/group-fairness-metrics/thresholds.ts`.
   */
  readonly violates: boolean;
  /** Threshold used. */
  readonly threshold: number;
  /** Brief human-readable interpretation. */
  readonly interpretation: string;
}

// ---------------------------------------------------------------------------
// Mitigation strategies
// ---------------------------------------------------------------------------

export type MitigationTier = 'pre_processing' | 'in_processing' | 'post_processing';

/** A reusable mitigation strategy descriptor. */
export interface MitigationStrategy {
  readonly id: string;
  readonly tier: MitigationTier;
  readonly description: string;
  /** Trade-offs the caller should be aware of. */
  readonly tradeoffs: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Drift monitoring
// ---------------------------------------------------------------------------

export interface BiasDriftObservation {
  readonly group: string;
  readonly prediction: 0 | 1;
  readonly label?: 0 | 1;
  /** Timestamp in ms epoch (defaults to `Date.now()` when omitted). */
  readonly tsMs?: number;
}

export interface BiasDriftAlert {
  readonly metric: BiasMetric;
  readonly baselineScore: number;
  readonly currentScore: number;
  /** Two-sample test p-value (lower = more drift). */
  readonly pValue: number;
  readonly threshold: number;
  readonly groupsObserved: ReadonlyArray<string>;
  readonly windowSize: number;
  readonly tsMs: number;
}

// ---------------------------------------------------------------------------
// Subgroup discovery
// ---------------------------------------------------------------------------

/**
 * Row used by Slice Finder. Has arbitrary categorical attributes
 * plus a prediction + label so we can compute slice performance.
 */
export interface SliceFinderRow {
  readonly attrs: Readonly<Record<string, string>>;
  readonly prediction: 0 | 1;
  readonly label: 0 | 1;
}

export interface SubgroupSlice {
  /** Attribute predicates that define the slice (AND-ed). */
  readonly predicates: Readonly<Record<string, string>>;
  /** Rows in this slice. */
  readonly size: number;
  /** Error rate of this slice. */
  readonly errorRate: number;
  /** Error rate of the global population. */
  readonly globalErrorRate: number;
  /** Slice error rate minus global error rate (positive = worse). */
  readonly delta: number;
  /** Two-sided binomial-test p-value for "this slice is the same as global". */
  readonly pValue: number;
}

// ---------------------------------------------------------------------------
// LLM bias benchmarks
// ---------------------------------------------------------------------------

/** Minimal LLM port the bias suites drive. */
export interface BiasBrain {
  /** Generic completion given a prompt; suite implementations adapt. */
  complete(prompt: string): Promise<string>;
}

/** Outcome of a single LLM bias benchmark run. */
export interface LLMBiasBenchmark {
  readonly suite: 'bbq' | 'stereoset' | 'crows_pairs' | 'honest' | 'real_toxicity_prompts';
  /** Overall single-number score, normalised in [0,1] — lower is better. */
  readonly overallScore: number;
  /** Per-category breakdown. */
  readonly perCategory: Readonly<Record<string, number>>;
  /** Items evaluated. */
  readonly itemsEvaluated: number;
  /** Suite-specific notes (e.g. "9 of 9 BBQ categories"). */
  readonly notes: string;
}

// ---------------------------------------------------------------------------
// Fairness constraint (consumed by in-processing mitigations)
// ---------------------------------------------------------------------------

export interface FairnessConstraint {
  readonly metric: BiasMetric;
  /** Max allowed disparity. */
  readonly maxDisparity: number;
  /** Optional Lagrange multiplier scale. */
  readonly lambda?: number;
}
