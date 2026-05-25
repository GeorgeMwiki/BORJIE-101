/**
 * Market-rate snapshots — Drizzle-backed adapter for the
 * `market_rate_snapshots` table (migration 0103). Adapts to the
 * market-surveillance agent's `MarketSurveillanceRepository.insertSnapshot`
 * + `listRecentSnapshots` shape (`@borjie/ai-copilot/ai-native/
 * market-surveillance`). The port is duck-typed so this service does
 * not compile-time-depend on ai-copilot.
 *
 * `listActiveUnits` is NOT implemented here — that data comes from the
 * occupancy / units repository, not the snapshots table. The composition
 * root composes a thin adapter that joins this service with that repo.
 *
 * Hard DB failures degrade gracefully:
 *   - insert : logs + rethrows so the agent records the gap
 *   - list   : returns [] on error so the caller never crashes
 */

import { and, desc, eq } from 'drizzle-orm';
import { marketRateSnapshots } from '../schemas/market-rate-snapshots.schema.js';
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

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export function createMarketRateSnapshotsService(
  db: DatabaseClient,
): MarketRateSnapshotsService {
  return {
    async insert(snapshot) {
      if (!snapshot.id || !snapshot.tenantId || !snapshot.unitId) {
        throw new Error(
          'market-rate-snapshots.insert requires id, tenantId, and unitId',
        );
      }
      try {
        await db.insert(marketRateSnapshots).values({
          id: snapshot.id,
          tenantId: snapshot.tenantId,
          unitId: snapshot.unitId,
          propertyId: snapshot.propertyId,
          currencyCode: snapshot.currencyCode,
          ourRentAmountMinor: snapshot.ourRentMinor,
          marketMedianMinor: snapshot.marketMedianMinor,
          marketP25Minor: snapshot.marketP25Minor,
          marketP75Minor: snapshot.marketP75Minor,
          marketSampleSize: snapshot.marketSampleSize,
          deltaPct: snapshot.deltaPct,
          driftFlag: snapshot.driftFlag,
          compRadiusKm: snapshot.compRadiusKm,
          sourceAdapter: snapshot.sourceAdapter,
          sourceMetadata: snapshot.sourceMetadata as Record<string, unknown>,
          modelVersion: snapshot.modelVersion,
          promptHash: snapshot.promptHash,
          observedAt: new Date(snapshot.observedAt),
        } as never);
        return snapshot;
      } catch (error) {
        logger.error('market-rate-snapshots.insert failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('market-rate-snapshots.insert failed');
      }
    },

    async listRecent(tenantId, args) {
      try {
        if (!tenantId) return [];
        const limit = clampLimit(args.limit, DEFAULT_LIMIT);
        const where = args.unitId
          ? and(
              eq(marketRateSnapshots.tenantId, tenantId),
              eq(marketRateSnapshots.unitId, args.unitId),
            )
          : eq(marketRateSnapshots.tenantId, tenantId);
        const rows = (await db
          .select()
          .from(marketRateSnapshots)
          .where(where)
          .orderBy(desc(marketRateSnapshots.observedAt))
          .limit(limit)) as ReadonlyArray<MarketRateRowDb>;
        return rows.map(rowToShape);
      } catch (error) {
        logger.error('market-rate-snapshots.listRecent failed', { error: error });
        return [];
      }
    },
  };
}

interface MarketRateRowDb {
  id: string;
  tenantId: string;
  unitId: string;
  propertyId: string | null;
  currencyCode: string;
  ourRentAmountMinor: number | string;
  marketMedianMinor: number | string | null;
  marketP25Minor: number | string | null;
  marketP75Minor: number | string | null;
  marketSampleSize: number | null;
  deltaPct: number | null;
  driftFlag: string | null;
  compRadiusKm: number | null;
  sourceAdapter: string;
  sourceMetadata: unknown;
  modelVersion: string;
  promptHash: string | null;
  observedAt: Date | string;
}

function rowToShape(row: MarketRateRowDb): MarketRateSnapshotShape {
  return {
    id: row.id,
    tenantId: row.tenantId,
    unitId: row.unitId,
    propertyId: row.propertyId,
    currencyCode: row.currencyCode,
    ourRentMinor: Number(row.ourRentAmountMinor),
    marketMedianMinor:
      row.marketMedianMinor === null ? null : Number(row.marketMedianMinor),
    marketP25Minor:
      row.marketP25Minor === null ? null : Number(row.marketP25Minor),
    marketP75Minor:
      row.marketP75Minor === null ? null : Number(row.marketP75Minor),
    marketSampleSize: row.marketSampleSize ?? 0,
    deltaPct: row.deltaPct,
    driftFlag: parseDriftFlag(row.driftFlag),
    compRadiusKm: row.compRadiusKm ?? 0,
    sourceAdapter: row.sourceAdapter,
    sourceMetadata:
      row.sourceMetadata && typeof row.sourceMetadata === 'object'
        ? (row.sourceMetadata as Record<string, unknown>)
        : {},
    modelVersion: row.modelVersion,
    promptHash: row.promptHash,
    observedAt:
      row.observedAt instanceof Date
        ? row.observedAt.toISOString()
        : String(row.observedAt),
  };
}

function parseDriftFlag(value: string | null): DriftFlag | null {
  if (value === 'below_market' || value === 'above_market' || value === 'on_band') {
    return value;
  }
  return null;
}

function clampLimit(input: number | undefined, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(input), MAX_LIMIT);
}

export { marketRateSnapshots };
