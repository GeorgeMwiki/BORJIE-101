/**
 * Market-rate snapshots — Drizzle-backed.
 *
 * Restores the market-surveillance write/read path (audit finding
 * `market-rate-snapshot-stub-11`: "writes silently discarded"). The
 * property-domain `market_rate_snapshots` table was dropped in the
 * mining migration. Until a dedicated `mine_market_rate_snapshots`
 * migration ships, snapshots persist durably and append-only against
 * the closed-loop `outcome_predictions` substrate (migration 0114) —
 * a tenant-scoped, RLS-FORCE-enabled, JSONB-carrying table — tagged
 * with `actionKind = 'market-rate-snapshot'`. A drift snapshot ("our
 * realised price is N% below market") is a forward-looking estate
 * signal, so the substrate is semantically coherent and, critically,
 * the write is now REAL rather than a no-op.
 *
 * `listRecent` reads the same rows back so the drift-detection feed
 * surfaces stored snapshots in the cockpit.
 *
 * Hard rules: tenant-scoped via RLS; immutable (spread, never mutate
 * the input); pino logger only; honest-degrade ([] on read failure,
 * structured rethrow on write failure — never a raw driver error).
 * Currency is read from the snapshot row, never hard-coded.
 */

import { randomUUID } from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { outcomePredictions } from '../schemas/outcome-telemetry.schema.js';
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

const ACTION_KIND = 'market-rate-snapshot';
const TARGET_ENTITY_TYPE = 'mining-unit';

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function clampConfidence(deltaPct: number | null): string {
  // Map drift magnitude (0..1+) to the [0,1] prediction-confidence band
  // so the surveillance feed can sort by signal strength.
  if (deltaPct == null || !Number.isFinite(deltaPct)) return '0.000';
  return Math.min(1, Math.max(0, Math.abs(deltaPct))).toFixed(3);
}

function rowToSnapshot(
  row: typeof outcomePredictions.$inferSelect,
): MarketRateSnapshotShape {
  const p = (row.predictedOutcome ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    tenantId: row.tenantId,
    unitId: row.actionTargetEntityId,
    propertyId: (p.propertyId as string | null) ?? null,
    currencyCode: String(p.currencyCode ?? 'TZS'),
    ourRentMinor: Number(p.ourRentMinor ?? 0),
    marketMedianMinor:
      p.marketMedianMinor == null ? null : Number(p.marketMedianMinor),
    marketP25Minor: p.marketP25Minor == null ? null : Number(p.marketP25Minor),
    marketP75Minor: p.marketP75Minor == null ? null : Number(p.marketP75Minor),
    marketSampleSize: Number(p.marketSampleSize ?? 0),
    deltaPct: p.deltaPct == null ? null : Number(p.deltaPct),
    driftFlag: (p.driftFlag as DriftFlag | null) ?? null,
    compRadiusKm: Number(p.compRadiusKm ?? 0),
    sourceAdapter: String(p.sourceAdapter ?? 'unknown'),
    sourceMetadata: (p.sourceMetadata ?? {}) as Record<string, unknown>,
    modelVersion: String(p.modelVersion ?? 'unknown'),
    promptHash: (p.promptHash as string | null) ?? null,
    observedAt: row.createdAt.toISOString(),
  };
}

export function createMarketRateSnapshotsService(
  db: DatabaseClient,
): MarketRateSnapshotsService {
  return {
    async insert(snapshot) {
      const id = isUuid(snapshot.id) ? snapshot.id : randomUUID();
      try {
        await db.insert(outcomePredictions).values({
          id,
          tenantId: snapshot.tenantId,
          actorKind: 'agent',
          actorId: snapshot.sourceAdapter || 'market-surveillance',
          actionKind: ACTION_KIND,
          actionTargetEntityType: TARGET_ENTITY_TYPE,
          actionTargetEntityId: snapshot.unitId,
          predictedOutcome: {
            propertyId: snapshot.propertyId,
            currencyCode: snapshot.currencyCode,
            ourRentMinor: snapshot.ourRentMinor,
            marketMedianMinor: snapshot.marketMedianMinor,
            marketP25Minor: snapshot.marketP25Minor,
            marketP75Minor: snapshot.marketP75Minor,
            marketSampleSize: snapshot.marketSampleSize,
            deltaPct: snapshot.deltaPct,
            driftFlag: snapshot.driftFlag,
            compRadiusKm: snapshot.compRadiusKm,
            sourceAdapter: snapshot.sourceAdapter,
            sourceMetadata: snapshot.sourceMetadata,
            modelVersion: snapshot.modelVersion,
            promptHash: snapshot.promptHash,
          },
          predictionConfidence: clampConfidence(snapshot.deltaPct),
          predictionHorizonDays: 30,
          rationale:
            snapshot.driftFlag === 'below_market'
              ? 'Realised price below market band'
              : snapshot.driftFlag === 'above_market'
                ? 'Realised price above market band'
                : 'Realised price within market band',
        });
        return { ...snapshot, id };
      } catch (err) {
        logger.error('market-rate-snapshots.insert failed', {
          tenantId: snapshot.tenantId,
          err: err instanceof Error ? err.message : String(err),
        });
        throw new Error('Failed to persist market-rate snapshot');
      }
    },

    async listRecent(tenantId, args) {
      const limit = Math.max(1, Math.min(100, args.limit ?? 20));
      try {
        const conditions = [
          eq(outcomePredictions.tenantId, tenantId),
          eq(outcomePredictions.actionKind, ACTION_KIND),
        ];
        if (args.unitId) {
          conditions.push(
            eq(outcomePredictions.actionTargetEntityId, args.unitId),
          );
        }
        const rows = await db
          .select()
          .from(outcomePredictions)
          .where(and(...conditions))
          .orderBy(desc(outcomePredictions.createdAt))
          .limit(limit);
        return rows.map(rowToSnapshot);
      } catch (err) {
        logger.warn('market-rate-snapshots.listRecent degraded to []', {
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        });
        return [];
      }
    },
  };
}
