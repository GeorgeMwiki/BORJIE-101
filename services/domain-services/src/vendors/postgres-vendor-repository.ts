/**
 * Postgres Vendor Repository — SCAFFOLDED 9 (Wave 3 amplified).
 *
 * Concrete implementation of `VendorRepositoryPort` backed by Drizzle +
 * Postgres. Kept free of business logic — scoring and rating recompute
 * live in `vendor-score-calculator.ts` and `vendor-rating-worker.ts`
 * respectively.
 *
 * Two constructor shapes are supported:
 *   1. Legacy `DrizzleLike` stub surface (used by in-memory tests) —
 *      preserves the Wave 2 scaffold entrypoint.
 *   2. A real Drizzle client + schema handles via `createPostgresVendorRepositoryV2`
 *      which uses the `@borjie/database` vendors/work_orders tables with
 *      proper WHERE clauses and tenant isolation.
 */

import { and, eq, gte, lte, notInArray } from 'drizzle-orm';
import type {
  FindCandidatesParams,
  VendorMatchCategory,
  VendorProfileDto,
  VendorRatingUpdate,
  VendorRepositoryPort,
  VendorWorkOrderOutcomeDto,
} from './vendor-repository.interface.js';

// ---------------------------------------------------------------------------
// Minimal abstraction over the Drizzle client — tests mock this directly.
// We intentionally avoid importing the real Drizzle module to keep this
// file buildable without DB credentials present.
// ---------------------------------------------------------------------------

export interface DrizzleLike {
  query: {
    vendors: {
      findMany(args: unknown): Promise<VendorRowLike[]>;
      findFirst(args: unknown): Promise<VendorRowLike | null>;
    };
    workOrders?: {
      findMany(args: unknown): Promise<WorkOrderOutcomeRowLike[]>;
    };
  };
  execute?: (query: unknown) => Promise<unknown>;
  update?: (table: unknown) => {
    set(values: Record<string, unknown>): {
      where(condition: unknown): Promise<unknown>;
    };
  };
}

export interface VendorRowLike {
  id: string;
  tenantId: string;
  vendorCode: string;
  companyName: string;
  status: string;
  specializations?: unknown;
  serviceAreas?: unknown;
  rateCards?: unknown;
  performanceMetrics?: unknown;
  isPreferred: boolean;
  emergencyAvailable: boolean;
  ratingLastComputedAt?: Date | null;
  ratingSampleSize?: number | null;
}

export interface WorkOrderOutcomeRowLike {
  id: string;
  vendorId: string | null;
  tenantId: string;
  completedAt: Date | null;
  ratingOverall?: number | null;
  ratingQuality?: number | null;
  ratingCommunication?: number | null;
  firstResponseMinutes?: number | null;
  scheduledAt?: Date | null;
  actualStartAt?: Date | null;
  actualCompletionAt?: Date | null;
  costActual?: number | null;
  costEstimated?: number | null;
  wasReopened?: boolean | null;
}

// ---------------------------------------------------------------------------
// Row → DTO mapping
// ---------------------------------------------------------------------------

function coerceArray<T>(raw: unknown, fallback: T[] = []): T[] {
  if (Array.isArray(raw)) return raw as T[];
  return fallback;
}

function coerceObject<T extends Record<string, unknown>>(raw: unknown, fallback: T): T {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as T;
  return fallback;
}

function mapVendorRow(row: VendorRowLike): VendorProfileDto {
  const metrics = coerceObject(row.performanceMetrics, {}) as Record<string, unknown>;
  const ratings = coerceObject((metrics as { ratings?: unknown }).ratings, {}) as Record<
    string,
    unknown
  >;
  const rateCard = coerceArray<{ hourlyRate?: number; currency?: string }>(row.rateCards, []);
  const firstRate = rateCard[0];

  return {
    id: row.id,
    tenantId: row.tenantId,
    vendorCode: row.vendorCode,
    name: row.companyName,
    status: row.status as VendorProfileDto['status'],
    categories: coerceArray<VendorMatchCategory>(row.specializations, []),
    serviceAreas: coerceArray<string>(row.serviceAreas, []),
    ratings: {
      overall: Number(ratings.overall ?? 0),
      quality: Number(ratings.quality ?? 0),
      reliability: Number(ratings.reliability ?? 0),
      communication: Number(ratings.communication ?? 0),
      value: Number(ratings.value ?? 0),
    },
    metrics: {
      completedJobs: Number((metrics as { completedJobs?: number }).completedJobs ?? 0),
      averageResponseTimeHours: Number(
        (metrics as { averageResponseTimeHours?: number }).averageResponseTimeHours ?? 0
      ),
      onTimeCompletionPct: Number(
        (metrics as { onTimeCompletionPct?: number }).onTimeCompletionPct ?? 0
      ),
      repeatCallRatePct: Number(
        (metrics as { repeatCallRatePct?: number }).repeatCallRatePct ?? 0
      ),
    },
    isPreferred: Boolean(row.isPreferred),
    emergencyAvailable: Boolean(row.emergencyAvailable),
    afterHoursAvailable: Boolean((metrics as { afterHoursAvailable?: boolean }).afterHoursAvailable),
    ratingLastComputedAt: row.ratingLastComputedAt ?? null,
    ratingSampleSize: row.ratingSampleSize ?? 0,
    hourlyRate: firstRate?.hourlyRate ?? null,
    // Currency is stored on the vendor_rates row at registration.
    // Empty string (when truly missing) surfaces the bad data rather
    // than silently mislabeling a non-Kenya vendor as KES.
    currency: firstRate?.currency ?? '',
  };
}

function mapWorkOrderOutcome(row: WorkOrderOutcomeRowLike): VendorWorkOrderOutcomeDto | null {
  if (!row.vendorId || !row.completedAt) return null;
  return {
    workOrderId: row.id,
    vendorId: row.vendorId,
    tenantId: row.tenantId,
    completedAt: row.completedAt,
    ratingOverall: row.ratingOverall ?? null,
    ratingQuality: row.ratingQuality ?? null,
    ratingCommunication: row.ratingCommunication ?? null,
    firstResponseMinutes: row.firstResponseMinutes ?? null,
    scheduledAt: row.scheduledAt ?? null,
    actualStartAt: row.actualStartAt ?? null,
    actualCompletionAt: row.actualCompletionAt ?? null,
    costActual: row.costActual ?? null,
    costEstimated: row.costEstimated ?? null,
    wasReopened: Boolean(row.wasReopened),
  };
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class PostgresVendorRepository implements VendorRepositoryPort {
  constructor(private readonly db: DrizzleLike) {}

  async findCandidates(params: FindCandidatesParams): Promise<VendorProfileDto[]> {
    const excluded = new Set(params.excludeStatuses ?? ['suspended', 'blacklisted']);
    const limit = params.limit ?? 50;

    // The query shape uses `findMany` with a filter hint — the actual
    // Drizzle implementation can refine with SQL filters; at the
    // interface level we let this be permissive so the repo can
    // be wired to different query helpers.
    // nosemgrep: missing-tenant-id-arg reason: Drizzle relational query — tenantId is inside the `where` clause, not at the top level the rule expects.
    const rows = await this.db.query.vendors.findMany({
      where: {
        tenantId: params.tenantId,
      },
      limit,
    });

    return rows
      .map(mapVendorRow)
      .filter((v) => !excluded.has(v.status))
      .filter((v) => v.categories.includes(params.category))
      .filter((v) =>
        params.serviceArea ? v.serviceAreas.includes(params.serviceArea) : true
      )
      .filter((v) => (params.emergency ? v.emergencyAvailable : true));
  }

  async findById(tenantId: string, vendorId: string): Promise<VendorProfileDto | null> {
    const row = await this.db.query.vendors.findFirst({
      where: { id: vendorId, tenantId },
    });
    return row ? mapVendorRow(row) : null;
  }

  async findAllActive(tenantId: string): Promise<VendorProfileDto[]> {
    // Status filter is applied at the DB layer via the `where` clause;
    // no need for a JS-side `.filter((v) => v.status === 'active')` afterwards.
    // nosemgrep: missing-tenant-id-arg reason: Drizzle relational query — tenantId is inside the `where` clause, not at the top level the rule expects.
    const rows = await this.db.query.vendors.findMany({
      where: { tenantId, status: 'active' },
    });
    return rows.map(mapVendorRow);
  }

  async listRecentOutcomes(params: {
    tenantId: string;
    vendorId: string;
    windowStart: Date;
    windowEnd: Date;
  }): Promise<VendorWorkOrderOutcomeDto[]> {
    if (!this.db.query.workOrders) return [];
    // Date-range filter pushed into the Drizzle relational query as
    // `completedAt: { gte: windowStart, lte: windowEnd }` so the DB
    // honours the window via an index range scan rather than fetching
    // every outcome row for the (tenantId, vendorId) pair.
    // nosemgrep: missing-tenant-id-arg reason: Drizzle relational query — tenantId is inside the `where` clause, not at the top level the rule expects.
    const rows = await this.db.query.workOrders.findMany({
      where: {
        tenantId: params.tenantId,
        vendorId: params.vendorId,
        completedAt: {
          gte: params.windowStart,
          lte: params.windowEnd,
        },
      },
    });
    return rows
      .map(mapWorkOrderOutcome)
      .filter((o): o is VendorWorkOrderOutcomeDto => o !== null);
  }

  async updateRatingAggregate(update: VendorRatingUpdate): Promise<void> {
    // We write back through an update path. If the injected client
    // doesn't expose `.update`, we no-op — tests typically stub this.
    if (!this.db.update) return;
    await this.db
      .update({ name: 'vendors' })
      .set({
        performanceMetrics: {
          ratings: update.ratings,
          completedJobs: update.metrics.completedJobs,
          averageResponseTimeHours: update.metrics.averageResponseTimeHours,
          onTimeCompletionPct: update.metrics.onTimeCompletionPct,
          repeatCallRatePct: update.metrics.repeatCallRatePct,
        },
        ratingLastComputedAt: update.computedAt,
        ratingSampleSize: update.sampleSize,
        updatedAt: new Date(),
      })
      .where({ id: update.vendorId, tenantId: update.tenantId });
  }
}

/**
 * Convenience factory — accepts a Drizzle client and returns the repo.
 * Keeps the construction noise out of each call site.
 */
export function createPostgresVendorRepository(db: DrizzleLike): VendorRepositoryPort {
  return new PostgresVendorRepository(db);
}

// ---------------------------------------------------------------------------
// V2 — Full Drizzle implementation (Wave 3)
//
// Uses real SQL WHERE filters against `vendors` + `workOrders` tables from
// `@borjie/database`. Preserves tenant isolation. Instantiate via
// `createPostgresVendorRepositoryV2({ db, schemas })` when a live DB is wired.
// ---------------------------------------------------------------------------

export interface VendorRepositorySchemas {
  vendors: any;
  workOrders: any;
}

export interface DrizzleV2Client {
  select: (...args: unknown[]) => any;
  update: (...args: unknown[]) => any;
}

export class PostgresVendorRepositoryV2 implements VendorRepositoryPort {
  constructor(
    private readonly db: DrizzleV2Client,
    private readonly schemas: VendorRepositorySchemas
  ) {}

  async findCandidates(params: FindCandidatesParams): Promise<VendorProfileDto[]> {
    const { vendors } = this.schemas;
    const excluded = params.excludeStatuses ?? ['suspended', 'blacklisted'];
    const limit = params.limit ?? 50;

    // Status exclusion + emergency-availability filter are pushed into
    // the Drizzle WHERE clause (NOT IN + eq) so the DB skips ineligible
    // rows entirely. Jsonb-array predicates for categories / serviceAreas
    // stay in JS — Drizzle's portable jsonb-contains operator is not
    // available against the test fake used by upstream callers.
    const conditions = [eq(vendors.tenantId, params.tenantId)];
    if (excluded.length > 0) {
      conditions.push(notInArray(vendors.status, excluded));
    }
    if (params.emergency) {
      conditions.push(eq(vendors.emergencyAvailable, true));
    }
    const rows = await this.db
      .select()
      .from(vendors)
      .where(and(...conditions))
      .limit(limit * 2);

    const profiles = (rows as VendorRowLike[]).map(mapVendorRow);
    return profiles
      .filter((v) => v.categories.includes(params.category))
      .filter((v) =>
        params.serviceArea ? v.serviceAreas.includes(params.serviceArea) : true
      )
      .slice(0, limit);
  }

  async findById(tenantId: string, vendorId: string): Promise<VendorProfileDto | null> {
    const { vendors } = this.schemas;
    const rows = await this.db
      .select()
      .from(vendors)
      .where(and(eq(vendors.id, vendorId), eq(vendors.tenantId, tenantId)))
      .limit(1);
    const row = (rows as VendorRowLike[])[0];
    return row ? mapVendorRow(row) : null;
  }

  async findAllActive(tenantId: string): Promise<VendorProfileDto[]> {
    const { vendors } = this.schemas;
    const rows = await this.db
      .select()
      .from(vendors)
      .where(and(eq(vendors.tenantId, tenantId), eq(vendors.status, 'active')));
    return (rows as VendorRowLike[]).map(mapVendorRow);
  }

  async listRecentOutcomes(params: {
    tenantId: string;
    vendorId: string;
    windowStart: Date;
    windowEnd: Date;
  }): Promise<VendorWorkOrderOutcomeDto[]> {
    const { workOrders } = this.schemas;
    if (!workOrders) return [];
    const rows = await this.db
      .select()
      .from(workOrders)
      .where(
        and(
          eq(workOrders.tenantId, params.tenantId),
          eq(workOrders.vendorId, params.vendorId),
          gte(workOrders.completedAt, params.windowStart),
          lte(workOrders.completedAt, params.windowEnd)
        )
      );
    return (rows as WorkOrderOutcomeRowLike[])
      .map(mapWorkOrderOutcome)
      .filter((o): o is VendorWorkOrderOutcomeDto => o !== null);
  }

  async updateRatingAggregate(update: VendorRatingUpdate): Promise<void> {
    const { vendors } = this.schemas;
    await this.db
      .update(vendors)
      .set({
        performanceMetrics: {
          ratings: update.ratings,
          completedJobs: update.metrics.completedJobs,
          averageResponseTimeHours: update.metrics.averageResponseTimeHours,
          onTimeCompletionPct: update.metrics.onTimeCompletionPct,
          repeatCallRatePct: update.metrics.repeatCallRatePct,
        },
        ratingLastComputedAt: update.computedAt,
        ratingSampleSize: update.sampleSize,
        updatedAt: new Date(),
      })
      .where(and(eq(vendors.id, update.vendorId), eq(vendors.tenantId, update.tenantId)));
  }
}

export function createPostgresVendorRepositoryV2(opts: {
  db: DrizzleV2Client;
  schemas: VendorRepositorySchemas;
}): VendorRepositoryPort {
  return new PostgresVendorRepositoryV2(opts.db, opts.schemas);
}
