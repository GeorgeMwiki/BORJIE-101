/**
 * @borjie/anomaly-detection — public type contracts.
 *
 * Pure types only — no runtime. The contracts here are the **only**
 * shapes the rest of the platform (capability-catalogue, executive
 * brief engine, alerting pipeline, Mr. Mwikila's dashboards) should
 * depend on.
 *
 * Numerical conventions:
 *   - All vectors are ReadonlyArray<number>.
 *   - All matrices are ReadonlyArray<ReadonlyArray<number>>.
 *   - All inputs are non-mutating: detectors copy before reordering.
 *   - Anomaly scores carry a `scoreKind` so consumers can interpret
 *     them correctly (an iForest score of 0.7 means something very
 *     different from a LOF score of 0.7).
 */

// ───────────────────────────────────────────────────────────────────
// Score and verdict shapes — produced by every detector.
// ───────────────────────────────────────────────────────────────────

/**
 * Identifies which detector family produced a score. Useful for
 * consumers that need to normalise across detectors or pick the right
 * threshold heuristic.
 */
export type ScoreKind =
  | 'iforest'
  | 'lof'
  | 'one-class-svm'
  | 'autoencoder'
  | 'zscore'
  | 'mad'
  | 'ensemble';

/**
 * The output of scoring a single observation.
 *
 * `value` — the raw observed value (or, for multivariate detectors,
 * the *first* component or a domain-meaningful scalar — the full
 * vector goes in `evidence.vector`).
 */
export interface AnomalyScore {
  readonly value: number;
  readonly score: number;
  readonly scoreKind: ScoreKind;
  readonly threshold: number;
  readonly anomalous: boolean;
}

/**
 * The "full" verdict shape persisted in `anomaly_detections`. Every
 * verdict is targetable (`target` — what was scored) and carries
 * structured evidence.
 */
export interface AnomalyVerdict {
  readonly tenantId: string;
  readonly detector: string;
  readonly target: string;
  readonly value: number;
  readonly score: number;
  readonly threshold: number;
  readonly anomalous: boolean;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly detectedAtIso: string;
}

// ───────────────────────────────────────────────────────────────────
// Detector configuration shapes.
// ───────────────────────────────────────────────────────────────────

export type WindowSize = number;

/**
 * Common configuration applicable to most detectors. Detector-
 * specific options layer on top in their own interfaces.
 */
export interface DetectorConfig {
  /** Decision threshold; semantics depend on `scoreKind`. */
  readonly threshold?: number;
  /** Optional human-readable detector identity for logging /
   *  persistence. */
  readonly detectorId?: string;
}

export interface IsolationForestConfig extends DetectorConfig {
  /** Number of trees in the forest. Default 100. */
  readonly nTrees?: number;
  /** Sub-sample size used to build each tree. Default 256. */
  readonly psi?: number;
  /** Seed for the internal PRNG. */
  readonly seed?: number;
  /** Anomaly score threshold in [0, 1]. Default 0.5. */
  readonly threshold?: number;
}

export interface LocalOutlierFactorConfig extends DetectorConfig {
  /** Number of neighbours `k`. Default 20. */
  readonly k?: number;
  /** LOF score threshold. Default 1.5. */
  readonly threshold?: number;
}

export interface ZScoreConfig extends DetectorConfig {
  /** |z| threshold. Default 3. */
  readonly threshold?: number;
}

export interface MadConfig extends DetectorConfig {
  /** |robust z| threshold. Default 3.5. */
  readonly threshold?: number;
}

export interface OneClassSvmPortConfig extends DetectorConfig {
  /** Decision-function threshold (negative = outlier in sklearn
   *  convention). Default 0. */
  readonly threshold?: number;
}

export interface AutoencoderPortConfig extends DetectorConfig {
  /** Quantile of historic reconstruction errors above which a fresh
   *  error is anomalous. Default 0.99. */
  readonly quantile?: number;
}

// ───────────────────────────────────────────────────────────────────
// Drift detector shapes.
// ───────────────────────────────────────────────────────────────────

/** Drift detector identity. */
export type DriftDetectorKind = 'adwin' | 'kswin' | 'page-hinkley';

/**
 * The verdict emitted by a drift detector at every step.
 *
 * `driftDetected` becomes true when the detector concludes the recent
 * stream differs from the reference window.
 */
export interface DriftSignal {
  readonly kind: DriftDetectorKind;
  readonly driftDetected: boolean;
  /** Detector-specific statistic at this step. */
  readonly statistic: number;
  /** The threshold the statistic was compared against. */
  readonly threshold: number;
  /** Number of samples observed so far. */
  readonly samples: number;
}

export interface AdwinConfig {
  /** Confidence parameter δ in (0, 1). Default 0.002. */
  readonly delta?: number;
  /** Minimum window length before any cut is considered. Default 5. */
  readonly minWindow?: number;
}

export interface KswinConfig {
  /** Reference / recent window size. Default 100. */
  readonly windowSize?: number;
  /** Two-sample KS critical α. Default 0.005. */
  readonly alpha?: number;
}

export interface PageHinkleyConfig {
  /** Magnitude of allowed deviation before the cumulative sum
   *  grows. Default 0.005. */
  readonly delta?: number;
  /** Detection threshold λ. Default 50. */
  readonly threshold?: number;
  /** Forgetting factor α in (0, 1]; 1 = no forgetting. Default 1. */
  readonly alpha?: number;
}

// ───────────────────────────────────────────────────────────────────
// Ensemble shapes.
// ───────────────────────────────────────────────────────────────────

/**
 * One detector's input into an ensemble. The caller has already
 * scored the observation with the underlying detector; the ensemble
 * combines the resulting `AnomalyScore`s.
 */
export interface EnsembleMember {
  readonly detectorId: string;
  readonly score: AnomalyScore;
  /** Weight in [0, 1] used by the weighted-score combiner. Defaults
   *  to 1 / k inside the combiner. */
  readonly weight?: number;
}

export interface VotingEnsembleConfig {
  /** 'majority' counts how many members fired; 'weighted' sums
   *  normalised scores. Default 'majority'. */
  readonly mode?: 'majority' | 'weighted';
  /** For 'weighted': overall decision threshold on the combined
   *  weighted sum, in [0, 1]. Default 0.5. */
  readonly threshold?: number;
}

export interface EnsembleVerdict {
  readonly anomalous: boolean;
  readonly mode: 'majority' | 'weighted';
  readonly combinedScore: number;
  readonly threshold: number;
  readonly votes: number;
  readonly totalMembers: number;
  readonly contributions: ReadonlyArray<{
    readonly detectorId: string;
    readonly anomalous: boolean;
    readonly normalisedScore: number;
    readonly weight: number;
  }>;
}

// ───────────────────────────────────────────────────────────────────
// Online stream wrapper shapes.
// ───────────────────────────────────────────────────────────────────

export interface StreamDetectorConfig {
  /** Warm-up size before scoring begins. Default 64. */
  readonly warmup?: number;
  /** Maximum window size. Default 1024. */
  readonly maxWindow?: number;
  /** Number of new samples between detector refits. Default 256. */
  readonly refitEvery?: number;
}

// ───────────────────────────────────────────────────────────────────
// Repository contract — the SQL adapter lives in @borjie/database;
// this package owns the interface only.
// ───────────────────────────────────────────────────────────────────

export interface AnomalyDetectionInsertInput {
  readonly tenantId: string;
  readonly detector: string;
  readonly target: string;
  readonly value: number;
  readonly score: number;
  readonly threshold: number;
  readonly anomalous: boolean;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface AnomalyDetectionRow {
  readonly id: string;
  readonly tenantId: string;
  readonly detector: string;
  readonly target: string;
  readonly value: number;
  readonly score: number;
  readonly threshold: number;
  readonly anomalous: boolean;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly detectedAt: Date;
  readonly prevHash: string;
  readonly auditHash: string;
}

export interface AnomalyDetectionRepository {
  insert(input: AnomalyDetectionInsertInput): Promise<AnomalyDetectionRow>;
  findById(id: string): Promise<AnomalyDetectionRow | null>;
  listByTenant(
    tenantId: string,
    options?: { readonly limit?: number; readonly anomalousOnly?: boolean },
  ): Promise<ReadonlyArray<AnomalyDetectionRow>>;
  listByTarget(
    tenantId: string,
    target: string,
    options?: { readonly limit?: number },
  ): Promise<ReadonlyArray<AnomalyDetectionRow>>;
}
