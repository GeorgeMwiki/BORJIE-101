/**
 * @borjie/data-analysis — public type contracts.
 *
 * Pure types only — no runtime. The contracts here are the **only**
 * shapes the rest of the platform (capability-catalogue, executive
 * brief engine, voice-agent for Mr. Mwikila) should depend on.
 *
 * Numerical conventions:
 *   - All vectors are ReadonlyArray<number>.
 *   - All inputs are non-mutating: primitives copy before reordering.
 *   - "Probability" values are in [0, 1].
 *   - "p-value" fields are always two-sided unless explicitly marked.
 */

// ───────────────────────────────────────────────────────────────────
// Descriptive statistics — the result of summarising a single vector.
// ───────────────────────────────────────────────────────────────────

export interface DescriptiveStats {
  readonly n: number;
  readonly mean: number;
  readonly median: number;
  readonly variance: number;       // sample variance (n − 1 denominator)
  readonly stddev: number;         // sqrt of sample variance
  readonly min: number;
  readonly max: number;
  readonly range: number;          // max − min
  readonly q1: number;             // 25th percentile, linear interp
  readonly q3: number;             // 75th percentile, linear interp
  readonly iqr: number;            // q3 − q1
  readonly skewness: number;       // adjusted Fisher-Pearson, type-2
  readonly kurtosis: number;       // excess kurtosis, type-2
}

// ───────────────────────────────────────────────────────────────────
// Inferential tests — every test returns a uniform shape so they
// compose cleanly behind a capability-catalogue invocation.
// ───────────────────────────────────────────────────────────────────

export type AlternativeHypothesis = 'two-sided' | 'less' | 'greater';

export interface HypothesisTestResult {
  readonly statistic: number;
  readonly pValue: number;             // two-sided unless test docs say otherwise
  readonly df?: number;                // degrees of freedom (where defined)
  readonly alternative: AlternativeHypothesis;
  readonly testName: string;           // human-readable label
  readonly nObservations: number;      // total sample size considered
  readonly rejectH0: boolean;          // pValue < alpha (alpha default 0.05)
  readonly alpha: number;              // significance level used for rejectH0
}

// ───────────────────────────────────────────────────────────────────
// Correlation — matrices over a set of vectors, indexed by column name.
// ───────────────────────────────────────────────────────────────────

export interface CorrelationMatrix {
  readonly method: 'pearson' | 'spearman' | 'kendall';
  readonly columns: ReadonlyArray<string>;
  /**
   * Square matrix; entry [i][j] is the correlation between
   * columns[i] and columns[j]. Diagonal is exactly 1.
   */
  readonly values: ReadonlyArray<ReadonlyArray<number>>;
  readonly n: number;
}

// ───────────────────────────────────────────────────────────────────
// Regression — uniform shape across OLS, polynomial, logistic.
// ───────────────────────────────────────────────────────────────────

export interface RegressionResult {
  readonly model: 'ols' | 'polynomial' | 'logistic';
  /** Coefficients in the same order as the feature matrix columns.
   *  For OLS / polynomial the leading entry is the intercept. */
  readonly coefficients: ReadonlyArray<number>;
  readonly nObservations: number;
  readonly nFeatures: number;
  /** Coefficient of determination — only defined for OLS / polynomial. */
  readonly r2?: number;
  /** Mean squared residual error. */
  readonly mse?: number;
  /** Final negative log-likelihood (logistic) or sum of squared residuals (OLS). */
  readonly loss: number;
  readonly iterations?: number;   // IRLS iterations for logistic
  readonly converged?: boolean;
}

// ───────────────────────────────────────────────────────────────────
// Distribution surface — every distribution exports this shape.
// ───────────────────────────────────────────────────────────────────

export interface ContinuousDistribution {
  readonly name: string;
  readonly pdf: (x: number) => number;
  readonly cdf: (x: number) => number;
  /** Inverse CDF (quantile function), p ∈ (0, 1). */
  readonly quantile: (p: number) => number;
  readonly sample: (n: number, seed?: number) => ReadonlyArray<number>;
  readonly mean: number;
  readonly variance: number;
}

export interface DiscreteDistribution {
  readonly name: string;
  /** Probability mass at k. */
  readonly pmf: (k: number) => number;
  readonly cdf: (k: number) => number;
  readonly quantile: (p: number) => number;
  readonly sample: (n: number, seed?: number) => ReadonlyArray<number>;
  readonly mean: number;
  readonly variance: number;
}

// ───────────────────────────────────────────────────────────────────
// Clustering — every clusterer returns a uniform shape.
// ───────────────────────────────────────────────────────────────────

export interface ClusterAssignment {
  readonly method: 'kmeans' | 'dbscan' | 'hierarchical';
  /** Cluster index per input row. −1 means "noise" (DBSCAN only). */
  readonly labels: ReadonlyArray<number>;
  readonly nClusters: number;
  readonly centroids?: ReadonlyArray<ReadonlyArray<number>>;  // kmeans only
  readonly iterations?: number;
  readonly converged?: boolean;
}

// ───────────────────────────────────────────────────────────────────
// Dimensionality reduction.
// ───────────────────────────────────────────────────────────────────

export interface PcaResult {
  /** Eigenvectors of the covariance matrix, sorted descending by eigenvalue. */
  readonly components: ReadonlyArray<ReadonlyArray<number>>;
  /** Eigenvalues — variance explained by each component, descending. */
  readonly eigenvalues: ReadonlyArray<number>;
  /** Fraction of total variance explained by each component. */
  readonly explainedVarianceRatio: ReadonlyArray<number>;
  /** Cumulative explained variance ratio. */
  readonly cumulativeExplained: ReadonlyArray<number>;
  /** Input rows projected into the new basis. */
  readonly transformed: ReadonlyArray<ReadonlyArray<number>>;
}

// ───────────────────────────────────────────────────────────────────
// DataFrame — see lite-dataframe.ts.
// ───────────────────────────────────────────────────────────────────

export type CellValue = string | number | boolean | null;

export interface DataFrame {
  readonly columns: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<CellValue>>;
  readonly nRows: number;
  readonly nCols: number;
  select(cols: ReadonlyArray<string>): DataFrame;
  filter(pred: (row: Readonly<Record<string, CellValue>>) => boolean): DataFrame;
  groupBy(col: string): ReadonlyMap<CellValue, DataFrame>;
  column(col: string): ReadonlyArray<CellValue>;
  numericColumn(col: string): ReadonlyArray<number>;
  aggregate<R>(col: string, fn: (xs: ReadonlyArray<number>) => R): R;
}
