/**
 * `@borjie/causal-inference` — public types.
 *
 * The four-step causal-inference pipeline (model -> identify ->
 * estimate -> refute) is expressed entirely in pure-data structures:
 *
 *  - `CausalGraph` — the DAG over named variables, optionally annotated
 *    with edge lags for time-series causal discovery.
 *  - `IdentificationStrategy` — back-door, front-door, DiD, synthetic-
 *    control, RD, Granger, PCMCI+.
 *  - `TreatmentEffect` — the estimated ATE / DiD coefficient / lagged
 *    coefficient with a 95 % confidence interval.
 *  - `Counterfactual` — the twin-network output: P(Y_{do(X=x*)} | obs).
 *  - `PCMCIResult` — DAG + p-value matrix returned from the tigramite
 *    sidecar.
 *  - `CausalRunRecord` — the row shape persisted into `causal_runs`.
 *
 * Every type is `readonly` end-to-end; producers must construct new
 * objects rather than mutating in place. Aligns with the project's
 * global immutability rule.
 *
 * @module @borjie/causal-inference/types
 */

// ---------------------------------------------------------------------------
// Identification strategies
// ---------------------------------------------------------------------------

export const IDENTIFICATION_STRATEGIES = [
  'backdoor',
  'frontdoor',
  'did',
  'synthetic-control',
  'rd',
  'granger',
  'pcmci-plus',
] as const;

export type IdentificationStrategy =
  (typeof IDENTIFICATION_STRATEGIES)[number];

// ---------------------------------------------------------------------------
// CausalGraph — DAG over named variables
// ---------------------------------------------------------------------------

/**
 * A single directed edge in the causal graph.
 *
 * `lag` is the time-lag (in periods) for time-series PCMCI+ /
 * Granger. `lag = 0` is contemporaneous causation, `lag = 1` is a
 * one-period-back driver.
 */
export interface CausalEdge {
  readonly from: string;
  readonly to: string;
  readonly lag?: number;
}

/**
 * Directed acyclic graph. We do NOT enforce acyclicity in the type;
 * the back-door / front-door identifiers check it at runtime and
 * raise `CausalInferenceError` if violated.
 */
export interface CausalGraph {
  readonly nodes: ReadonlyArray<string>;
  readonly edges: ReadonlyArray<CausalEdge>;
}

// ---------------------------------------------------------------------------
// TreatmentEffect — point estimate + 95 % CI
// ---------------------------------------------------------------------------

export interface TreatmentEffect {
  readonly treatment: string;
  readonly outcome: string;
  readonly identification: IdentificationStrategy;
  readonly estimate: number;
  readonly ciLow: number;
  readonly ciHigh: number;
  /** Optional standard error of the estimator. */
  readonly standardError?: number;
  /** Sample size N actually used by the estimator. */
  readonly sampleSize: number;
}

// ---------------------------------------------------------------------------
// Counterfactual — twin-network output
// ---------------------------------------------------------------------------

export interface Counterfactual {
  readonly query: string;
  /** Observed assignment that conditioned the counterfactual. */
  readonly observed: Readonly<Record<string, number>>;
  /** Intervention (do-operator). */
  readonly intervention: Readonly<Record<string, number>>;
  /** Outcome under the intervention. */
  readonly counterfactualOutcome: number;
  /** Outcome actually observed (factual). */
  readonly factualOutcome: number;
}

// ---------------------------------------------------------------------------
// PCMCIResult — tigramite sidecar return shape
// ---------------------------------------------------------------------------

export interface PCMCIResult {
  /** Discovered DAG. */
  readonly graph: CausalGraph;
  /** p-value for each discovered edge, keyed `from->to@lag`. */
  readonly pValues: Readonly<Record<string, number>>;
  /** Maximum lag considered by the run. */
  readonly maxLag: number;
}

// ---------------------------------------------------------------------------
// Refutation report
// ---------------------------------------------------------------------------

export interface RefutationReport {
  readonly placeboEffect: number;
  readonly bootstrapCiLow: number;
  readonly bootstrapCiHigh: number;
  /** E-value: how strong an unobserved confounder would have to be to
      explain the effect. >= 2.0 considered robust. */
  readonly eValue: number;
}

// ---------------------------------------------------------------------------
// Causal run record — `causal_runs` row shape
// ---------------------------------------------------------------------------

export interface CausalRunRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly question: string;
  readonly treatment: string;
  readonly outcome: string;
  readonly identification: IdentificationStrategy;
  readonly effectEstimate: number;
  readonly ciLow: number;
  readonly ciHigh: number;
  readonly ranAt: Date;
  readonly prevHash: string;
  readonly auditHash: string;
}

export interface CausalRunInsert {
  readonly tenantId: string;
  readonly question: string;
  readonly treatment: string;
  readonly outcome: string;
  readonly identification: IdentificationStrategy;
  readonly effectEstimate: number;
  readonly ciLow: number;
  readonly ciHigh: number;
}

export interface CausalRunRepository {
  insert(input: CausalRunInsert): Promise<CausalRunRecord>;
  findById(tenantId: string, id: string): Promise<CausalRunRecord | null>;
  listForTenant(
    tenantId: string,
    filter?: {
      readonly identification?: IdentificationStrategy;
      readonly limit?: number;
    },
  ): Promise<ReadonlyArray<CausalRunRecord>>;
}

// ---------------------------------------------------------------------------
// Python sidecar port — async boundary to tigramite / DoWhy
// ---------------------------------------------------------------------------

export interface PythonSidecarRequest {
  /** 'pcmci-plus' or 'dowhy-ate'. */
  readonly kind: 'pcmci-plus' | 'dowhy-ate';
  /** Opaque payload — the consumer (PCMCI+ / DoWhy port) defines the
      schema; the sidecar bridge does not interpret it. */
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface PythonSidecarResponse {
  readonly ok: boolean;
  readonly result?: Readonly<Record<string, unknown>>;
  readonly error?: string;
}

export interface PythonSidecarPort {
  /**
   * Returns `null` to signal "sidecar not configured" — the consumer
   * then degrades to the pure-TS alternative (Granger / DiD).
   */
  call(request: PythonSidecarRequest): Promise<PythonSidecarResponse | null>;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export const CAUSAL_ERROR_CODES = [
  'CYCLE_DETECTED',
  'UNKNOWN_NODE',
  'BACKDOOR_NOT_IDENTIFIABLE',
  'FRONTDOOR_NOT_IDENTIFIABLE',
  'INSUFFICIENT_DATA',
  'SIDECAR_UNAVAILABLE',
  'INVALID_PANEL',
  'INVALID_TIME_SERIES',
] as const;

export type CausalErrorCode = (typeof CAUSAL_ERROR_CODES)[number];

export class CausalInferenceError extends Error {
  public override readonly name: string = 'CausalInferenceError';
  public readonly code: CausalErrorCode;

  public constructor(code: CausalErrorCode, message: string) {
    super(message);
    this.code = code;
    Object.setPrototypeOf(this, CausalInferenceError.prototype);
  }
}
