/**
 * Market-rate snapshots — TODO(#29) stub.
 *
 * The original Drizzle adapter targeted the `market_rate_snapshots`
 * table (migration 0103). The mining-equivalent will track commodity
 * spot prices vs realised sale prices and live under marketplace +
 * production-sales schemas. Until then the service exposes a no-op
 * surface so the market-surveillance composition root still wires.
 */

import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';

export type DriftFlag = 'below_market' | 'above_market' | 'on_band';

export interface MarketRateSnapshotShape {
  readonly id: string;
  readonly tenantId: string;
  readonly unitId: string;
  readonly propertyId: string | null;
  readonly currencyCode: string;
  readonly ourRentMinor: number;
  readonly marketMedianMinor: number | null;
  readonly marketP25Minor: number | null;
  readonly marketP75Minor: number | null;
  readonly marketSampleSize: number;
  readonly deltaPct: number | null;
  readonly driftFlag: DriftFlag | null;
  readonly compRadiusKm: number;
  readonly sourceAdapter: string;
  readonly sourceMetadata: Readonly<Record<string, unknown>>;
  readonly modelVersion: string;
  readonly promptHash: string | null;
  readonly observedAt: string;
}

export interface ListRecentArgs {
  readonly unitId?: string;
  readonly limit?: number;
}

export interface MarketRateSnapshotsService {
  insert(snapshot: MarketRateSnapshotShape): Promise<MarketRateSnapshotShape>;
  listRecent(
    tenantId: string,
    args: ListRecentArgs,
  ): Promise<ReadonlyArray<MarketRateSnapshotShape>>;
}

export function createMarketRateSnapshotsService(
  _db: DatabaseClient,
): MarketRateSnapshotsService {
  return {
    async insert(snapshot) {
      logger.warn(
        'market-rate-snapshots.insert: stub (mining-domain rewrite pending)',
        { tenantId: snapshot.tenantId },
      );
      return snapshot;
    },
    async listRecent() {
      return [];
    },
  };
}
