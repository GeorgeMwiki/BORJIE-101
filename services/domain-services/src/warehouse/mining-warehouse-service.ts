/**
 * Mining Warehouse Service — ore-stockpile inventory + ore grading.
 *
 * Replaces the retired property-inventory warehouse service. Every
 * read/write is delegated to the two mining Drizzle repositories, which
 * already bind `app.current_tenant_id` (RLS FORCE) and never double-filter
 * from app code:
 *
 *   - OreWarehouseRepository  → ore_stockpiles (custody + tonnage)
 *   - OreGradingRepository    → ore_grade_snapshots (headline grade)
 *
 * Domain mapping (property → mining):
 *   - "item"     → ore STOCKPILE  (a physical pile of a parcel's ore in a
 *                  known custody location: site | warehouse | in_transit)
 *   - "movement" → CUSTODY EVENT  (the append-only custody chain on the
 *                  stockpile row; a "transfer" appends one entry and
 *                  re-projects custodian + location).
 *   - quantity   → quantityKg     (tonnage in kilograms, denormalised)
 *   - condition  → grade          (headline grade % from the latest
 *                  grade snapshot of the stockpile's parcel)
 *
 * Tonnage in `ore_stockpiles` is immutable per custody hand-over (a
 * transfer moves the same pile, it does not mint/burn mass) — re-tonnaging
 * is a fresh stockpile row, mirroring how a re-grade is a fresh snapshot.
 *
 * All failures use the Result shape `{ ok: false, error: { code, message } }`
 * so the warehouse router maps them to HTTP status codes cleanly. Returned
 * objects are always new (immutable composition); the service holds no
 * internal state.
 */

import {
  ORE_STOCKPILE_LOCATION_KINDS,
  type OreStockpileLocationKind,
} from '@borjie/database';
import type { TenantId } from '@borjie/domain-models';
import { randomHex } from '../common/id-generator.js';
import type {
  CreateStockpileInput,
  OreStockpile,
  OreWarehouseRepository,
  RecordCustodyTransferInput,
} from '../ore/ore-warehouse-types.js';
import type {
  CreateSnapshotInput,
  OreGradeSnapshotRecord,
  OreGradingRepository,
} from '../ore/drizzle-ore-grading-repository.js';

// ----------------------------------------------------------------------------
// Result + error shape (router-aligned)
// ----------------------------------------------------------------------------

export type MiningWarehouseErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'TENANT_MISMATCH'
  | 'INTERNAL_ERROR';

export interface MiningWarehouseError {
  readonly code: MiningWarehouseErrorCode;
  readonly message: string;
}

export type MiningWarehouseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: MiningWarehouseError };

function ok<T>(value: T): MiningWarehouseResult<T> {
  return { ok: true, value };
}

function err<T = never>(
  code: MiningWarehouseErrorCode,
  message: string,
): MiningWarehouseResult<T> {
  return { ok: false, error: { code, message } };
}

// ----------------------------------------------------------------------------
// View shapes — what the router returns to the admin UI. The grade fields
// are enriched from the latest grade snapshot of the stockpile's parcel.
// ----------------------------------------------------------------------------

/** A stockpile row enriched with its parcel's latest headline grade. */
export interface StockpileView extends OreStockpile {
  readonly gradePct: number | null;
  readonly processability: number | null;
  readonly targetCustomerFit: string | null;
  readonly gradeSnapshotAt: string | null;
}

/** One entry of the append-only custody chain (the mining "movement"). */
export interface CustodyEventView {
  readonly id: string;
  readonly stockpileId: string;
  readonly ts: string;
  readonly fromUserId: string | null;
  readonly toUserId: string | null;
  readonly fromLocationKind: string | null;
  readonly fromLocationRef: string | null;
  readonly toLocationKind: string | null;
  readonly toLocationRef: string | null;
  readonly fingerprintEventId: string | null;
}

// ----------------------------------------------------------------------------
// Inputs accepted by the router (loose at the boundary; repos re-validate
// with Zod). `id` is service-minted when omitted so callers POST without it.
// ----------------------------------------------------------------------------

export interface CreateStockpileRequest {
  readonly parcelId: string;
  readonly siteId?: string | null;
  readonly locationKind?: OreStockpileLocationKind;
  readonly locationRef?: string | null;
  readonly quantityKg: number;
  readonly custodianUserId?: string | null;
  readonly attributes?: Record<string, unknown>;
}

export interface TransferRequest {
  readonly stockpileId: string;
  readonly toUserId: string;
  readonly toLocationKind: OreStockpileLocationKind;
  readonly toLocationRef?: string | null;
  readonly fingerprintEventId?: string | null;
  readonly occurredAt?: string;
}

export interface GradeRequest {
  readonly parcelId: string;
  readonly gradePct: number;
  readonly processability: number;
  readonly blendability: number;
  readonly targetCustomerFit?: CreateSnapshotInput['targetCustomerFit'];
  readonly assayEvidenceIds?: readonly string[];
  readonly dimensions?: Record<string, unknown>;
  readonly snapshotByModel?: string | null;
}

export interface ListStockpilesFilters {
  /** Restrict to one custody location kind; omit for all kinds. */
  readonly locationKind?: OreStockpileLocationKind;
  /** Restrict to a single parcel's stockpiles. */
  readonly parcelId?: string;
}

// ----------------------------------------------------------------------------
// Service contract
// ----------------------------------------------------------------------------

export interface MiningWarehouseService {
  listStockpiles(
    tenantId: string,
    filters?: ListStockpilesFilters,
  ): Promise<readonly StockpileView[]>;
  createStockpile(
    tenantId: string,
    input: CreateStockpileRequest,
    actorUserId: string,
  ): Promise<MiningWarehouseResult<StockpileView>>;
  getStockpile(
    tenantId: string,
    stockpileId: string,
  ): Promise<MiningWarehouseResult<StockpileView | null>>;
  recordTransfer(
    tenantId: string,
    input: TransferRequest,
    actorUserId: string,
  ): Promise<MiningWarehouseResult<StockpileView>>;
  listCustodyEvents(
    tenantId: string,
    stockpileId: string,
  ): Promise<MiningWarehouseResult<readonly CustodyEventView[]>>;
  recordGrade(
    tenantId: string,
    input: GradeRequest,
    actorUserId: string,
  ): Promise<MiningWarehouseResult<OreGradeSnapshotRecord>>;
}

export interface MiningWarehouseServiceDeps {
  readonly stockpiles: OreWarehouseRepository;
  readonly grading: OreGradingRepository;
  readonly idGenerator?: () => string;
}

// ----------------------------------------------------------------------------
// Internal helpers (kept <50 lines each, nesting ≤4)
// ----------------------------------------------------------------------------

/** Enrich a stockpile with the latest grade snapshot for its parcel. */
function enrich(
  stockpile: OreStockpile,
  grade: OreGradeSnapshotRecord | null | undefined,
): StockpileView {
  return {
    ...stockpile,
    gradePct: grade ? grade.gradePct : null,
    processability: grade ? grade.processability : null,
    targetCustomerFit: grade ? grade.targetCustomerFit : null,
    gradeSnapshotAt: grade ? grade.snapshotAt : null,
  };
}

/** Project a stockpile's append-only custody log into stable view rows. */
function toCustodyEvents(stockpile: OreStockpile): readonly CustodyEventView[] {
  return stockpile.custodyEventLog.map((raw, index) => {
    const entry = raw as Record<string, unknown>;
    const str = (k: string): string | null =>
      entry[k] == null ? null : String(entry[k]);
    return {
      id: `${stockpile.id}:${index}`,
      stockpileId: stockpile.id,
      ts: str('ts') ?? new Date(0).toISOString(),
      fromUserId: str('fromUserId'),
      toUserId: str('toUserId'),
      fromLocationKind: str('fromLocationKind'),
      fromLocationRef: str('fromLocationRef'),
      toLocationKind: str('toLocationKind'),
      toLocationRef: str('toLocationRef'),
      fingerprintEventId: str('fingerprintEventId'),
    };
  });
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error';
}

/** Map a repo "not found" throw to a NOT_FOUND result; rethrow otherwise. */
function isNotFound(message: string): boolean {
  return /not found|missing after/i.test(message);
}

// ----------------------------------------------------------------------------
// Factory
// ----------------------------------------------------------------------------

export function createMiningWarehouseService(
  deps: MiningWarehouseServiceDeps,
): MiningWarehouseService {
  const genId = deps.idGenerator ?? (() => `stk_${randomHex(12)}`);

  async function gradesFor(
    tenantId: string,
  ): Promise<ReadonlyMap<string, OreGradeSnapshotRecord>> {
    return deps.grading.findLatestByTenant(tenantId as TenantId);
  }

  async function collectStockpiles(
    tenantId: string,
    filters: ListStockpilesFilters,
  ): Promise<readonly OreStockpile[]> {
    const tid = tenantId as TenantId;
    if (filters.parcelId) {
      return deps.stockpiles.listByParcel(tid, filters.parcelId);
    }
    if (filters.locationKind) {
      return deps.stockpiles.listByLocation(tid, filters.locationKind);
    }
    // No filter: union every custody location kind. Each call is tenant
    // scoped by the repo (RLS-bound), so this never leaks across tenants.
    const perKind = await Promise.all(
      ORE_STOCKPILE_LOCATION_KINDS.map((kind) =>
        deps.stockpiles.listByLocation(tid, kind),
      ),
    );
    return perKind.flat();
  }

  return {
    async listStockpiles(tenantId, filters) {
      if (!tenantId) return [];
      const [rows, grades] = await Promise.all([
        collectStockpiles(tenantId, filters ?? {}),
        gradesFor(tenantId),
      ]);
      return rows.map((row) => enrich(row, grades.get(row.parcelId)));
    },

    async createStockpile(tenantId, input, actorUserId) {
      if (!tenantId) return err('VALIDATION', 'tenantId is required');
      if (!input.parcelId) return err('VALIDATION', 'parcelId is required');
      if (!Number.isFinite(input.quantityKg) || input.quantityKg < 0) {
        return err('VALIDATION', 'quantityKg must be a non-negative number');
      }
      const payload: CreateStockpileInput = {
        id: genId(),
        parcelId: input.parcelId,
        siteId: input.siteId ?? null,
        locationKind: input.locationKind ?? 'site',
        locationRef: input.locationRef ?? null,
        quantityKg: input.quantityKg,
        custodianUserId: input.custodianUserId ?? actorUserId,
        attributes: input.attributes ?? {},
      };
      try {
        const created = await deps.stockpiles.createStockpile(
          tenantId as TenantId,
          payload,
        );
        const grade = await deps.grading.findLatestByParcel(
          tenantId as TenantId,
          created.parcelId,
        );
        return ok(enrich(created, grade));
      } catch (e) {
        return err('INTERNAL_ERROR', messageOf(e));
      }
    },

    async getStockpile(tenantId, stockpileId) {
      if (!tenantId) return err('VALIDATION', 'tenantId is required');
      if (!stockpileId) return err('VALIDATION', 'stockpileId is required');
      try {
        const row = await deps.stockpiles.findById(
          tenantId as TenantId,
          stockpileId,
        );
        if (!row) return ok(null);
        const grade = await deps.grading.findLatestByParcel(
          tenantId as TenantId,
          row.parcelId,
        );
        return ok(enrich(row, grade));
      } catch (e) {
        return err('INTERNAL_ERROR', messageOf(e));
      }
    },

    async recordTransfer(tenantId, input, actorUserId) {
      if (!tenantId) return err('VALIDATION', 'tenantId is required');
      if (!input.stockpileId) {
        return err('VALIDATION', 'stockpileId is required');
      }
      const toUserId = input.toUserId || actorUserId;
      if (!toUserId) return err('VALIDATION', 'toUserId is required');
      const payload: RecordCustodyTransferInput = {
        stockpileId: input.stockpileId,
        toUserId,
        toLocationKind: input.toLocationKind,
        toLocationRef: input.toLocationRef ?? null,
        fingerprintEventId: input.fingerprintEventId ?? null,
        occurredAt: input.occurredAt,
      };
      try {
        const after = await deps.stockpiles.recordCustodyTransfer(
          tenantId as TenantId,
          payload,
        );
        const grade = await deps.grading.findLatestByParcel(
          tenantId as TenantId,
          after.parcelId,
        );
        return ok(enrich(after, grade));
      } catch (e) {
        const msg = messageOf(e);
        if (isNotFound(msg)) {
          return err('NOT_FOUND', `stockpile ${input.stockpileId} not found`);
        }
        return err('INTERNAL_ERROR', msg);
      }
    },

    async listCustodyEvents(tenantId, stockpileId) {
      if (!tenantId) return err('VALIDATION', 'tenantId is required');
      if (!stockpileId) return err('VALIDATION', 'stockpileId is required');
      try {
        const row = await deps.stockpiles.findById(
          tenantId as TenantId,
          stockpileId,
        );
        if (!row) {
          return err('NOT_FOUND', `stockpile ${stockpileId} not found`);
        }
        return ok(toCustodyEvents(row));
      } catch (e) {
        return err('INTERNAL_ERROR', messageOf(e));
      }
    },

    async recordGrade(tenantId, input, _actorUserId) {
      if (!tenantId) return err('VALIDATION', 'tenantId is required');
      if (!input.parcelId) return err('VALIDATION', 'parcelId is required');
      const payload: CreateSnapshotInput = {
        id: `grd_${randomHex(12)}`,
        parcelId: input.parcelId,
        gradePct: input.gradePct,
        processability: input.processability,
        blendability: input.blendability,
        targetCustomerFit: input.targetCustomerFit ?? null,
        assayEvidenceIds: [...(input.assayEvidenceIds ?? [])],
        dimensions: input.dimensions ?? {},
        snapshotByModel: input.snapshotByModel ?? null,
      };
      try {
        const snapshot = await deps.grading.persistSnapshot(
          tenantId as TenantId,
          payload,
        );
        // Denormalise the headline grade onto the parcel so listing
        // widgets don't have to walk the snapshot table per render.
        await deps.grading.updateParcelHeadlineGrade(
          tenantId as TenantId,
          input.parcelId,
          { gradePct: snapshot.gradePct },
        );
        return ok(snapshot);
      } catch (e) {
        return err('INTERNAL_ERROR', messageOf(e));
      }
    },
  };
}
