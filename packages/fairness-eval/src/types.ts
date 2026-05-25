/**
 * `@borjie/fairness-eval` — public types.
 *
 * Counterfactual fairness: flip a single protected attribute in a
 * fixture profile; run the agent on the original + counterfactual;
 * compare outcomes. If the agent diverges by attribute alone, that is
 * a fairness violation.
 *
 * Ported from LITFIN PROJECT/src/core/brain/counterfactual.ts +
 * src/core/credit-mind/fairness/audit-harness.ts.
 */

/** ISO-3166-1 alpha-2 country code. */
export type Jurisdiction = string;

/** A protected-attribute category id (e.g. 'race', 'tribe'). */
export type ProtectedAttribute = string;

/** Profile under test. Free-form record of strings. */
export type Profile = Readonly<Record<string, string | number | boolean | null>>;

/** Decision a profile yields when run through the brain. */
export interface BrainDecision {
  readonly outcome: 'approve' | 'deny' | 'escalate';
  /** Numeric score [0,1] — higher = more positive. */
  readonly score: number;
  readonly reasonCodes: ReadonlyArray<string>;
}

/** Brain port the eval drives. */
export interface FairnessBrain {
  decide(profile: Profile): Promise<BrainDecision>;
}

/** A protected-attribute spec — defines flip values for the eval. */
export interface ProtectedAttributeSpec {
  readonly id: ProtectedAttribute;
  /** Profile key holding the attribute value (e.g. 'race', 'gender'). */
  readonly profileKey: string;
  /** Possible values to flip across. */
  readonly values: ReadonlyArray<string>;
  /** Jurisdictions where this attribute is legally protected. */
  readonly jurisdictions: ReadonlyArray<Jurisdiction>;
  /** Statute citation for audit logs. */
  readonly citation: string;
}

/** Pair of (original, counterfactual) profiles. */
export interface CounterfactualPair {
  readonly attribute: ProtectedAttribute;
  readonly profileKey: string;
  readonly originalValue: string;
  readonly counterfactualValue: string;
  readonly originalProfile: Profile;
  readonly counterfactualProfile: Profile;
}

/** Outcome comparison for a single counterfactual pair. */
export interface FairnessScore {
  readonly pair: CounterfactualPair;
  readonly originalDecision: BrainDecision;
  readonly counterfactualDecision: BrainDecision;
  /** True if outcome strings diverge. */
  readonly outcomeDiverges: boolean;
  /** |original.score − counterfactual.score|. */
  readonly scoreDelta: number;
  /** Reason codes present in one decision but not the other. */
  readonly reasonCodesDiverge: ReadonlyArray<string>;
  /** True if scoreDelta > tolerance OR outcomeDiverges. */
  readonly violatesFairness: boolean;
}

/** A violation report aggregated across multiple pairs. */
export interface ViolationReport {
  readonly attribute: ProtectedAttribute;
  readonly jurisdiction: Jurisdiction;
  readonly citation: string;
  readonly pairsTested: number;
  readonly violations: number;
  readonly violationRate: number;
  readonly worstScoreDelta: number;
  readonly pairScores: ReadonlyArray<FairnessScore>;
}

export interface FairnessEvalOptions {
  readonly brain: FairnessBrain;
  /** Default jurisdiction the eval runs against. */
  readonly jurisdiction: Jurisdiction;
  /**
   * Max acceptable absolute score difference between original +
   * counterfactual. Default 0.05.
   */
  readonly scoreTolerance?: number;
}

export interface FairnessEval {
  readonly jurisdiction: Jurisdiction;
  readonly scoreTolerance: number;
  /** Run a single fixture against a single attribute. */
  scoreProfile(args: {
    profile: Profile;
    attribute: ProtectedAttribute;
  }): Promise<ViolationReport>;
  /** Run a fixture against every attribute applicable in the jurisdiction. */
  scoreAllApplicable(profile: Profile): Promise<ReadonlyArray<ViolationReport>>;
}
