/**
 * @borjie/data-analysis — public surface.
 *
 * SOTA statistical and analytical primitives for Mr. Mwikila's
 * data-driven decisions. Pure TypeScript, no native bindings,
 * reference-vector validated to ≥ 6 decimal places.
 *
 * See `Docs/DESIGN/DATA_ANALYSIS_SOTA_2026.md` for the full spec and
 * citations to the 11 primary sources.
 */

// Types
export type {
  DescriptiveStats,
  HypothesisTestResult,
  CorrelationMatrix,
  RegressionResult,
  ContinuousDistribution,
  DiscreteDistribution,
  ClusterAssignment,
  PcaResult,
  DataFrame,
  CellValue,
  AlternativeHypothesis,
} from './types.js';

// Logger
export {
  createLogger,
  defaultLogger,
  type Logger,
  type TelemetryConfig,
  type ServiceIdentity,
  type LogLevel,
  type LogEmitter,
} from './logger.js';

// Descriptive
export { mean } from './descriptive/mean.js';
export { median } from './descriptive/median.js';
export { quantile } from './descriptive/quantile.js';
export { variance } from './descriptive/variance.js';
export { stddev } from './descriptive/stddev.js';
export { skewness } from './descriptive/skewness.js';
export { kurtosis } from './descriptive/kurtosis.js';
export { iqr } from './descriptive/iqr.js';
export { mode } from './descriptive/mode.js';
export { histogram, type HistogramResult } from './descriptive/histogram.js';
export { describe } from './descriptive/summary.js';

// Inferential
export { oneSampleTTest, twoSampleTTest } from './inferential/t-test.js';
export { welchTTest } from './inferential/welch-t.js';
export { chiSquareIndependence } from './inferential/chi-square.js';
export { anovaOneWay } from './inferential/anova-one-way.js';
export { mannWhitneyU } from './inferential/mann-whitney.js';
export { kruskalWallis } from './inferential/kruskal-wallis.js';

// Correlation
export { pearson } from './correlation/pearson.js';
export { spearman } from './correlation/spearman.js';
export { kendall } from './correlation/kendall.js';
export { correlationMatrix, type NamedColumn } from './correlation/matrix.js';

// Regression
export { ols } from './regression/ols.js';
export { polynomial } from './regression/polynomial.js';
export { logistic, type LogisticOptions } from './regression/logistic.js';

// Distributions
export { normal } from './distributions/normal.js';
export { uniform } from './distributions/uniform.js';
export { exponential } from './distributions/exponential.js';
export { gammaDist } from './distributions/gamma.js';
export { betaDist } from './distributions/beta.js';
export { binomial } from './distributions/binomial.js';
export { poisson } from './distributions/poisson.js';
export { studentTCdf, studentTTwoSidedPValue } from './distributions/student-t.js';
export { chiSquareCdf, chiSquareUpperTail } from './distributions/chi-square.js';
export { fCdf, fUpperTail } from './distributions/f-dist.js';

// Cluster
export { kmeans, silhouetteScore, type KMeansOptions } from './cluster/kmeans.js';
export { dbscan } from './cluster/dbscan.js';
export { hierarchical, type Linkage } from './cluster/hierarchical.js';

// Dimensionality
export { pca } from './dimensionality/pca.js';
export { umapLite, type UmapOptions } from './dimensionality/umap-port.js';

// DataFrame
export { dataFrame, dataFrameFromRecords } from './dataframe/lite-dataframe.js';

// Sample
export { simpleRandomSample } from './sample/srs.js';
export { stratifiedSample, type Stratum } from './sample/stratified.js';

export { reservoirSample } from './sample/reservoir.js';
export { bootstrap, type BootstrapResult } from './sample/bootstrap.js';

// Domain
export {
  sitePerformanceStats,
  royaltyRateAnalysis,
  safetyIncidentCorrelation,
  buyerCohortAnalysis,
  type SitePerformance,
  type RoyaltyAnalysis,
  type SafetyCorrelation,
  type BuyerCohort,
} from './domain/mining-stats.js';

// Util (advanced)
export {
  logGamma,
  gamma,
  logBeta,
  erf,
  erfc,
  erfInv,
  regularisedGammaP,
  regularisedGammaQ,
  regularisedIncompleteBeta,
} from './util/special.js';
export { mulberry32, gaussianPair, type Prng } from './util/rng.js';
export {
  zeros,
  identity,
  transpose,
  matMul,
  matVec,
  solveLinearSystem,
  symmetricEig,
  type Matrix,
  type EigResult,
} from './util/matrix.js';
export { tiedRanks, type RankResult } from './util/ranks.js';
