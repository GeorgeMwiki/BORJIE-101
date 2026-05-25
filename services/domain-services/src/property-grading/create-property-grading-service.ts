/**
 * Factory helper — builds the three Postgres-backed adapters required
 * by the ai-copilot `PropertyGradingService`.
 *
 * The api-gateway composition root wraps these in the service class
 * from `@borjie/ai-copilot`; this package deliberately does not
 * depend on ai-copilot (to avoid the circular dep).
 */

import { DrizzleWeightsRepository } from './drizzle-weights-repository.js';
import { DrizzleSnapshotRepository } from './drizzle-snapshot-repository.js';
import { LiveMetricsSource } from './live-metrics-source.js';
import type {
  PropertyMetricsSource,
  SnapshotRepository,
  WeightsRepository,
} from './ports.js';

type DbClient = any;

export interface PropertyGradingAdapters {
  readonly metricsSource: PropertyMetricsSource;
  readonly weightsRepo: WeightsRepository;
  readonly snapshotRepo: SnapshotRepository;
}

export function createPropertyGradingAdapters(
  db: DbClient,
): PropertyGradingAdapters {
  return {
    metricsSource: new LiveMetricsSource({ db }),
    weightsRepo: new DrizzleWeightsRepository(db),
    snapshotRepo: new DrizzleSnapshotRepository(db),
  };
}
