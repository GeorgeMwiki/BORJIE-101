/**
 * `@borjie/anomaly-detection` — public surface.
 *
 * SOTA real-time + batch anomaly detection for Mr. Mwikila's mining
 * operations. Pure-TS detectors with Python sidecars behind ports.
 *
 * Companion spec: Docs/DESIGN/ANOMALY_DETECTION_SOTA_2026.md.
 * Persistence: migration 0070 (`packages/database/drizzle/0070_anomaly_detection.sql`).
 */

// Public types — the only shapes consumers should depend on.
export * from './types.js';

// Threshold detectors.
export {
  detectZScoreAnomaly,
  fitZScore,
  scoreZ,
} from './detectors/zscore-threshold.js';
export {
  detectMadAnomaly,
  fitMad,
  scoreMad,
} from './detectors/mad-threshold.js';

// Score-based detectors.
export {
  averagePathLength,
  detectIsolationForestAnomalies,
  fitIsolationForest,
  scoreIsolationForest,
  type IsolationForestModel,
} from './detectors/isolation-forest.js';
export {
  detectLocalOutlierFactor,
  type LofResult,
} from './detectors/local-outlier-factor.js';
export {
  createOneClassSvmStub,
  scoreOneClassSvm,
  type OneClassSvmPort,
} from './detectors/one-class-svm-port.js';
export {
  createAutoencoderStub,
  quantileThreshold,
  scoreAutoencoder,
  type AutoencoderPort,
} from './detectors/autoencoder-port.js';

// Drift detectors.
export {
  createAdwinState,
  updateAdwin,
  type AdwinState,
} from './drift/adwin.js';
export {
  createKswinState,
  updateKswin,
  type KswinState,
} from './drift/kswin.js';
export {
  createPageHinkleyState,
  updatePageHinkley,
  type PageHinkleyState,
} from './drift/page-hinkley.js';

// Online wrapper.
export {
  createUnivariateStreamState,
  pushUnivariate,
  type StreamStep,
  type UnivariateDetectorKind,
  type UnivariateStreamState,
} from './online/stream-detector.js';

// Ensembles.
export { combineVotes } from './ensemble/voting-ensemble.js';

// Mining-domain wrappers.
export {
  equipmentVibrationOutlier,
  fuelConsumptionSpike,
  royaltyFilingIrregularity,
  weightBridgeDeviation,
  workerCheckInMiss,
  type EquipmentVibrationInput,
  type FuelConsumptionInput,
  type RoyaltyFilingInput,
  type WeightBridgeInput,
  type WorkerCheckInInput,
} from './domain/mining-anomalies.js';

// Repositories.
export {
  computeAnomalyAuditHash,
  createInMemoryAnomalyDetectionRepository,
  createSqlAnomalyDetectionRepository,
  GENESIS_HASH,
  type SqlExecutor,
} from './repositories/anomaly-detection-repository.js';

// Logger (escape hatch — consumers should prefer DI from
// `@borjie/observability` in production).
export { createLogger, defaultLogger, type Logger } from './logger.js';
