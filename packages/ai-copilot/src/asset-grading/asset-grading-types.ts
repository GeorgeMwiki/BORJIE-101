/**
 * Asset-grading types.
 *
 * Mirrors mineral-asset performance underwriting (A+ through F with +/-
 * modifiers). We collapse the asset-performance taxonomy into six scoring
 * dimensions that map cleanly onto data we already collect:
 *
 *   - royalty_yield     (royalty collection, net operating income)
 *   - opex_efficiency   (operating-expense ratio vs sector benchmark)
 *   - maintenance       (equipment cost per site, resolution time, capex debt)
 *   - recovery          (asset utilisation, downtime, market-price ratio)
 *   - royalty_compliance(Mining Act / royalty-return breach count, open cases)
 *   - buyer_quality     (off-taker / counterparty satisfaction + quality proxy)
 *
 * The ore-grade reference standard (g/t, recovery %, assay/QA-QC) anchors the
 * dimension benchmarks the way RICS once anchored the real-estate model.
 *
 * All types are immutable (`readonly`) and plain values so the scoring
 * model can be serialised and reproduced from snapshots.
 */

/** Discrete 12-level grade scale. Ordering: A_PLUS is best, F is worst. */
export type AssetGrade =
  | 'A_PLUS'
  | 'A'
  | 'A_MINUS'
  | 'B_PLUS'
  | 'B'
  | 'B_MINUS'
  | 'C_PLUS'
  | 'C'
  | 'C_MINUS'
  | 'D_PLUS'
  | 'D'
  | 'F'
  | 'INSUFFICIENT_DATA';

/** Ordered list (best → worst) — used by UIs and aggregation. */
export const GRADE_ORDER: readonly AssetGrade[] = [
  'A_PLUS',
  'A',
  'A_MINUS',
  'B_PLUS',
  'B',
  'B_MINUS',
  'C_PLUS',
  'C',
  'C_MINUS',
  'D_PLUS',
  'D',
  'F',
];

/** Maps a grade to an integer rank (12 = A+, 1 = F). INSUFFICIENT_DATA → 0. */
export const GRADE_RANK: Readonly<Record<AssetGrade, number>> = Object.freeze({
  A_PLUS: 12,
  A: 11,
  A_MINUS: 10,
  B_PLUS: 9,
  B: 8,
  B_MINUS: 7,
  C_PLUS: 6,
  C: 5,
  C_MINUS: 4,
  D_PLUS: 3,
  D: 2,
  F: 1,
  INSUFFICIENT_DATA: 0,
});

/** Maps a rank back to the grade. */
export const RANK_TO_GRADE: Readonly<Record<number, AssetGrade>> = Object.freeze({
  12: 'A_PLUS',
  11: 'A',
  10: 'A_MINUS',
  9: 'B_PLUS',
  8: 'B',
  7: 'B_MINUS',
  6: 'C_PLUS',
  5: 'C',
  4: 'C_MINUS',
  3: 'D_PLUS',
  2: 'D',
  1: 'F',
  0: 'INSUFFICIENT_DATA',
});

/** The six scoring dimensions. */
export type GradeDimension =
  | 'royalty_yield'
  | 'opex_efficiency'
  | 'maintenance'
  | 'recovery'
  | 'royalty_compliance'
  | 'buyer_quality';

export const GRADE_DIMENSIONS: readonly GradeDimension[] = [
  'royalty_yield',
  'opex_efficiency',
  'maintenance',
  'recovery',
  'royalty_compliance',
  'buyer_quality',
];

/**
 * Per-tenant grading weights. Must sum to 1.0 (within 1e-6).
 * Defaults mirror mineral-asset underwriting priors but operators can
 * override any dimension via the `tenant_grading_weights` table.
 */
export interface GradingWeights {
  readonly royalty_yield: number;
  readonly opex_efficiency: number;
  readonly maintenance: number;
  readonly recovery: number;
  readonly royalty_compliance: number;
  readonly buyer_quality: number;
}

export const DEFAULT_GRADING_WEIGHTS: GradingWeights = Object.freeze({
  royalty_yield: 0.25,
  opex_efficiency: 0.2,
  maintenance: 0.2,
  recovery: 0.15,
  royalty_compliance: 0.1,
  buyer_quality: 0.1,
});

/**
 * Raw measured inputs for an asset over the evaluation window.
 * Every field is explicit — the caller must supply fresh data from the
 * real tables. A `null` marker signals "unknown" and triggers
 * INSUFFICIENT_DATA handling at the service layer.
 */
export interface AssetGradeInputs {
  readonly assetId: string;
  readonly tenantId: string;
  /** Asset utilisation / recovery rate over the window [0..1]. */
  readonly utilisationRate: number;
  /** Collected royalty / scheduled royalty [0..1]. */
  readonly royaltyCollectionRate: number;
  /** Net operating income in minor currency units. */
  readonly noi: number;
  /** Gross potential income in minor currency units (for NOI ratio). */
  readonly grossPotentialIncome: number;
  /** Operating expense ratio [0..1]. */
  readonly expenseRatio: number;
  /** Outstanding royalties as a share of scheduled royalty [0..1]. */
  readonly outstandingRoyaltyRatio: number;
  /** Mean hours from maintenance-case open → resolved. */
  readonly avgMaintenanceResolutionHours: number;
  /** Maintenance cost per site over the window, minor currency units. */
  readonly maintenanceCostPerSite: number;
  /** Count of open compliance breaches over the window. */
  readonly complianceBreachCount: number;
  /** Buyer / off-taker satisfaction proxy — CSAT or renewal rate [0..1]. */
  readonly buyerSatisfactionProxy: number;
  /** Average downtime in days for idled sites. */
  readonly downtimeDays: number;
  /** Outstanding planned-capex debt, minor currency units. */
  readonly capexDebt: number;
  /** Realised price divided by market price [0..~1.3]. Below 1.0 = under-priced. */
  readonly marketPriceRatio: number;
  /** Asset age in years. */
  readonly assetAge: number;
  /** Number of producing sites on the asset. */
  readonly siteCount: number;
}

/** Score (0..100) for a single dimension with a graded label. */
export interface DimensionScore {
  readonly dimension: GradeDimension;
  readonly score: number;
  readonly grade: AssetGrade;
  readonly explanation: string;
}

/** Full grade report for one asset. */
export interface AssetGradeReport {
  readonly assetId: string;
  readonly tenantId: string;
  readonly grade: AssetGrade;
  readonly score: number;
  readonly dimensions: Readonly<Record<GradeDimension, DimensionScore>>;
  readonly reasons: readonly string[];
  readonly weights: GradingWeights;
  readonly computedAt: string;
  readonly evidence?: Readonly<Record<string, unknown>>;
}

/** Portfolio rollup. */
export interface PortfolioGrade {
  readonly tenantId: string;
  readonly grade: AssetGrade;
  readonly score: number;
  readonly totalAssets: number;
  readonly distribution: Readonly<Record<AssetGrade, number>>;
  readonly topStrengths: readonly AssetGradeReport[];
  readonly topWeaknesses: readonly AssetGradeReport[];
  readonly trajectory?: {
    readonly previousScore: number;
    readonly delta: number;
    readonly direction: 'up' | 'down' | 'flat';
  } | undefined;
  readonly weightBy: 'site_count' | 'asset_value' | 'equal';
  readonly computedAt: string;
}

/** Historical grade entry for an asset. */
export interface GradeHistoryEntry {
  readonly assetId: string;
  readonly tenantId: string;
  readonly grade: AssetGrade;
  readonly score: number;
  readonly computedAt: string;
}

/** Raised when inputs are insufficient for a safe grade. */
export interface InsufficientDataReport {
  readonly assetId: string;
  readonly tenantId: string;
  readonly grade: 'INSUFFICIENT_DATA';
  readonly missingFields: readonly string[];
  readonly reasons: readonly string[];
}
