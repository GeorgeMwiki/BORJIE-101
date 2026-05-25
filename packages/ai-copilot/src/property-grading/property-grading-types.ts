/**
 * Property-grading types.
 *
 * Mirrors commercial real-estate underwriting (A+ through F with +/-
 * modifiers) and the RICS Asset Performance Standards 2024 six-dimension
 * taxonomy (financial, physical, legal/compliance, occupant, sustainability,
 * operational). We collapse the RICS six into six scoring dimensions that
 * map cleanly onto data we already collect:
 *
 *   - income       (rent collection, NOI)
 *   - expense      (expense ratio vs market benchmark)
 *   - maintenance  (cost per unit, resolution time, capex debt)
 *   - occupancy    (occupancy rate, vacancy duration, market rent ratio)
 *   - compliance   (breach count, open legal cases)
 *   - tenant       (tenant satisfaction + quality proxy)
 *
 * All types are immutable (`readonly`) and plain values so the scoring
 * model can be serialised and reproduced from snapshots.
 */

/** Discrete 12-level grade scale. Ordering: A_PLUS is best, F is worst. */
export type PropertyGrade =
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
export const GRADE_ORDER: readonly PropertyGrade[] = [
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
export const GRADE_RANK: Readonly<Record<PropertyGrade, number>> = Object.freeze({
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
export const RANK_TO_GRADE: Readonly<Record<number, PropertyGrade>> = Object.freeze({
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

/** The six scoring dimensions (aligned to RICS 2024). */
export type GradeDimension =
  | 'income'
  | 'expense'
  | 'maintenance'
  | 'occupancy'
  | 'compliance'
  | 'tenant';

export const GRADE_DIMENSIONS: readonly GradeDimension[] = [
  'income',
  'expense',
  'maintenance',
  'occupancy',
  'compliance',
  'tenant',
];

/**
 * Per-tenant grading weights. Must sum to 1.0 (within 1e-6).
 * Defaults mirror commercial underwriting priors but operators can
 * override any dimension via the `tenant_grading_weights` table.
 */
export interface GradingWeights {
  readonly income: number;
  readonly expense: number;
  readonly maintenance: number;
  readonly occupancy: number;
  readonly compliance: number;
  readonly tenant: number;
}

export const DEFAULT_GRADING_WEIGHTS: GradingWeights = Object.freeze({
  income: 0.25,
  expense: 0.2,
  maintenance: 0.2,
  occupancy: 0.15,
  compliance: 0.1,
  tenant: 0.1,
});

/**
 * Raw measured inputs for a property over the evaluation window.
 * Every field is explicit — the caller must supply fresh data from the
 * real tables. A `null` marker signals "unknown" and triggers
 * INSUFFICIENT_DATA handling at the service layer.
 */
export interface PropertyGradeInputs {
  readonly propertyId: string;
  readonly tenantId: string;
  /** Occupancy rate over the window [0..1]. */
  readonly occupancyRate: number;
  /** Collected rent / scheduled rent [0..1]. */
  readonly rentCollectionRate: number;
  /** Net operating income in minor currency units. */
  readonly noi: number;
  /** Gross potential income in minor currency units (for NOI ratio). */
  readonly grossPotentialIncome: number;
  /** Operating expense ratio [0..1]. */
  readonly expenseRatio: number;
  /** Outstanding arrears as a share of scheduled rent [0..1]. */
  readonly arrearsRatio: number;
  /** Mean hours from maintenance-case open → resolved. */
  readonly avgMaintenanceResolutionHours: number;
  /** Maintenance cost per unit over the window, minor currency units. */
  readonly maintenanceCostPerUnit: number;
  /** Count of open compliance breaches over the window. */
  readonly complianceBreachCount: number;
  /** Tenant satisfaction proxy — CSAT or renewal rate [0..1]. */
  readonly tenantSatisfactionProxy: number;
  /** Average vacancy duration in days for vacated units. */
  readonly vacancyDurationDays: number;
  /** Outstanding planned-capex debt, minor currency units. */
  readonly capexDebt: number;
  /** Current rent divided by market rent [0..~1.3]. Below 1.0 = under-let. */
  readonly marketRentRatio: number;
  /** Property age in years. */
  readonly propertyAge: number;
  /** Number of lettable units on the property. */
  readonly unitCount: number;
}

/** Score (0..100) for a single dimension with a graded label. */
export interface DimensionScore {
  readonly dimension: GradeDimension;
  readonly score: number;
  readonly grade: PropertyGrade;
  readonly explanation: string;
}

/** Full grade report for one property. */
export interface PropertyGradeReport {
  readonly propertyId: string;
  readonly tenantId: string;
  readonly grade: PropertyGrade;
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
  readonly grade: PropertyGrade;
  readonly score: number;
  readonly totalProperties: number;
  readonly distribution: Readonly<Record<PropertyGrade, number>>;
  readonly topStrengths: readonly PropertyGradeReport[];
  readonly topWeaknesses: readonly PropertyGradeReport[];
  readonly trajectory?: {
    readonly previousScore: number;
    readonly delta: number;
    readonly direction: 'up' | 'down' | 'flat';
  };
  readonly weightBy: 'unit_count' | 'asset_value' | 'equal';
  readonly computedAt: string;
}

/** Historical grade entry for a property. */
export interface GradeHistoryEntry {
  readonly propertyId: string;
  readonly tenantId: string;
  readonly grade: PropertyGrade;
  readonly score: number;
  readonly computedAt: string;
}

/** Raised when inputs are insufficient for a safe grade. */
export interface InsufficientDataReport {
  readonly propertyId: string;
  readonly tenantId: string;
  readonly grade: 'INSUFFICIENT_DATA';
  readonly missingFields: readonly string[];
  readonly reasons: readonly string[];
}
