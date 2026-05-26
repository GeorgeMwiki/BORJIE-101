/**
 * Factory helper — builds the Postgres-backed adapters required by the
 * ai-copilot `PropertyGradingService`.
 *
 * Mining-domain Wave 5 — the snapshot repo previously persisted to
 * `property_grade_snapshots` (dropped by migration 0003). The
 * snapshot adapter is no longer constructible against the mining
 * schema; the factory only returns the metricsSource + weightsRepo
 * pair. Composition root MUST source a snapshot adapter elsewhere
 * (e.g. the mining `DrizzleOreGradingRepository` under
 * `@borjie/domain-services/ore`) when wiring the grading service.
 */

import { DrizzleWeightsRepository } from './drizzle-weights-repository.js';
import { LiveMetricsSource } from './live-metrics-source.js';
import type {
  PropertyMetricsSource,
  WeightsRepository,
} from './ports.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = any;

export interface PropertyGradingAdapters {
  readonly metricsSource: PropertyMetricsSource;
  readonly weightsRepo: WeightsRepository;
}

export function createPropertyGradingAdapters(
  db: DbClient,
): PropertyGradingAdapters {
  return {
    metricsSource: new LiveMetricsSource({ db }),
    weightsRepo: new DrizzleWeightsRepository(db),
  };
}
