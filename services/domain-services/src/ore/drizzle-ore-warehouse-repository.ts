/**
 * Drizzle repository for ore stockpiles (Borjie mining).
 *
 * Each row in `ore_stockpiles` is the current custody state of a
 * physical pile of ore: on a mine site, at an external warehouse, or in
 * transit. Custody hand-overs are recorded by:
 *
 *   1. Appending a JSON entry to `custody_event_log_jsonb` (the audit
 *      trail) — atomic with the row update so a half-applied transfer
 *      can't leak.
 *   2. Updating `custodian_user_id`, `location_kind`, `location_ref`.
 *
 * The repository wraps custody transfers in a Postgres transaction so
 * the log entry and the projection are always consistent.
 *
 * Types, Zod schemas, and row mappers live in `./ore-warehouse-types.ts`.
 */

import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  oreStockpiles,
  type OreStockpileLocationKind,
} from '@borjie/database';
import type { TenantId } from '@borjie/domain-models';
import {
  createStockpileSchema,
  recordCustodyTransferSchema,
  rowToStockpile,
  type CreateStockpileInput,
  type OreStockpile,
  type OreWarehouseRepository,
  type RecordCustodyTransferInput,
} from './ore-warehouse-types.js';

// Types + Zod schemas live in `./ore-warehouse-types.ts` and reach
// the composition root via the `./index.ts` barrel.

// ---------------------------------------------------------------------------
// Drizzle client surface
// ---------------------------------------------------------------------------

interface DrizzleLike {
  select: (...args: unknown[]) => any;
  insert: (...args: unknown[]) => any;
  update: (...args: unknown[]) => any;
  transaction?: <T>(fn: (tx: DrizzleLike) => Promise<T>) => Promise<T>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class DrizzleOreWarehouseRepository implements OreWarehouseRepository {
  constructor(private readonly db: DrizzleLike) {}

  async createStockpile(
    tenantId: TenantId,
    input: CreateStockpileInput,
  ): Promise<OreStockpile> {
    const validated = createStockpileSchema.parse(input);
    const now = new Date();
    await this.db.insert(oreStockpiles).values({
      id: validated.id,
      tenantId: tenantId as unknown as string,
      parcelId: validated.parcelId,
      siteId: validated.siteId ?? null,
      locationKind: validated.locationKind,
      locationRef: validated.locationRef ?? null,
      quantityKg: String(validated.quantityKg),
      custodianUserId: validated.custodianUserId ?? null,
      custodyEventLogJsonb: [],
      storedAt: now,
      lastInspectedAt: null,
      attributes: validated.attributes,
      createdAt: now,
      updatedAt: now,
    });
    const created = await this.findById(tenantId, validated.id);
    if (!created) {
      throw new Error(`createStockpile failed for id ${validated.id}`);
    }
    return created;
  }

  async findById(
    tenantId: TenantId,
    stockpileId: string,
  ): Promise<OreStockpile | null> {
    const rows = await this.db
      .select()
      .from(oreStockpiles)
      .where(
        and(
          eq(oreStockpiles.id, stockpileId),
          eq(oreStockpiles.tenantId, tenantId as unknown as string),
        ),
      )
      .limit(1);
    return rows[0]
      ? rowToStockpile(rows[0] as Record<string, unknown>)
      : null;
  }

  async listByParcel(
    tenantId: TenantId,
    parcelId: string,
  ): Promise<readonly OreStockpile[]> {
    const rows = await this.db
      .select()
      .from(oreStockpiles)
      .where(
        and(
          eq(oreStockpiles.parcelId, parcelId),
          eq(oreStockpiles.tenantId, tenantId as unknown as string),
        ),
      )
      .orderBy(desc(oreStockpiles.updatedAt));
    return (rows as Array<Record<string, unknown>>).map(rowToStockpile);
  }

  async listByLocation(
    tenantId: TenantId,
    locationKind: OreStockpileLocationKind,
  ): Promise<readonly OreStockpile[]> {
    const rows = await this.db
      .select()
      .from(oreStockpiles)
      .where(
        and(
          eq(oreStockpiles.tenantId, tenantId as unknown as string),
          eq(oreStockpiles.locationKind, locationKind),
        ),
      )
      .orderBy(asc(oreStockpiles.storedAt));
    return (rows as Array<Record<string, unknown>>).map(rowToStockpile);
  }

  async recordCustodyTransfer(
    tenantId: TenantId,
    input: RecordCustodyTransferInput,
  ): Promise<OreStockpile> {
    const validated = recordCustodyTransferSchema.parse(input);
    const occurredAt = validated.occurredAt
      ? new Date(validated.occurredAt)
      : new Date();

    const runTransfer = async (tx: DrizzleLike): Promise<void> => {
      const existingRows = await tx
        .select()
        .from(oreStockpiles)
        .where(
          and(
            eq(oreStockpiles.id, validated.stockpileId),
            eq(oreStockpiles.tenantId, tenantId as unknown as string),
          ),
        )
        .limit(1);
      if (!existingRows[0]) {
        throw new Error(`stockpile ${validated.stockpileId} not found`);
      }
      const before = rowToStockpile(
        existingRows[0] as Record<string, unknown>,
      );
      const entry = {
        ts: occurredAt.toISOString(),
        fromUserId: before.custodianUserId,
        toUserId: validated.toUserId,
        fromLocationKind: before.locationKind,
        fromLocationRef: before.locationRef,
        toLocationKind: validated.toLocationKind,
        toLocationRef: validated.toLocationRef ?? null,
        fingerprintEventId: validated.fingerprintEventId ?? null,
      };
      await tx
        .update(oreStockpiles)
        .set({
          custodianUserId: validated.toUserId,
          locationKind: validated.toLocationKind,
          locationRef: validated.toLocationRef ?? null,
          custodyEventLogJsonb: sql`COALESCE(${oreStockpiles.custodyEventLogJsonb}, '[]'::jsonb) || ${JSON.stringify(
            [entry],
          )}::jsonb`,
          updatedAt: occurredAt,
        })
        .where(
          and(
            eq(oreStockpiles.id, validated.stockpileId),
            eq(oreStockpiles.tenantId, tenantId as unknown as string),
          ),
        );
    };

    if (typeof this.db.transaction === 'function') {
      await this.db.transaction(async (tx) => runTransfer(tx as DrizzleLike));
    } else {
      await runTransfer(this.db);
    }

    const after = await this.findById(tenantId, validated.stockpileId);
    if (!after) {
      throw new Error(
        `stockpile ${validated.stockpileId} missing after transfer`,
      );
    }
    return after;
  }

  async recordInspection(
    tenantId: TenantId,
    stockpileId: string,
    inspectionAt?: string,
  ): Promise<OreStockpile> {
    const ts = inspectionAt ? new Date(inspectionAt) : new Date();
    await this.db
      .update(oreStockpiles)
      .set({ lastInspectedAt: ts, updatedAt: ts })
      .where(
        and(
          eq(oreStockpiles.id, stockpileId),
          eq(oreStockpiles.tenantId, tenantId as unknown as string),
        ),
      );
    const after = await this.findById(tenantId, stockpileId);
    if (!after) {
      throw new Error(`stockpile ${stockpileId} missing after inspection`);
    }
    return after;
  }
}
