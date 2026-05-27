/**
 * Drizzle-backed Disbursement Repository.
 *
 * Production implementation of `IDisbursementRepository` against the
 * Drizzle-managed `disbursements` table (declared in
 * `packages/database/src/schemas/ledger.schema.ts`).
 *
 * Design notes:
 *
 *   - Tenant predicate is on EVERY query. RLS (migration 0166) is
 *     the belt; this repo is suspenders.
 *   - `findByTransferId` mirrors `DrizzlePaymentIntentRepository.
 *     findByExternalId`: tenantId is REQUIRED to prevent cross-tenant
 *     leakage if two tenants legitimately share a provider's transfer
 *     id namespace. The InMemory interface accepted (provider,
 *     transferId) only; we widen on the application layer signature
 *     change (callers pass tenantId) when wiring through, but to
 *     preserve interface compatibility for the InMemory adapter we
 *     keep the public method shape unchanged. Tenant scoping is
 *     enforced via the application-layer caller chain (the route
 *     handler passes tenantId through to lookups) and via RLS at the
 *     DB.
 *   - Idempotency: unique index `disbursements_idempotency_idx` on
 *     (tenant_id, idempotency_key) is the DB enforcement.
 *   - `find` accepts pagination clamped to 1-500.
 */

import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { CurrencyCode, OwnerId, TenantId } from '@borjie/domain-models';
import { type DatabaseClient } from '@borjie/database';
import { disbursements, type DisbursementRow } from './drizzle-schema';
import type {
  Disbursement,
  DisbursementFilters,
  DisbursementPaginatedResult,
  DisbursementStatus,
  IDisbursementRepository,
} from './disbursement.repository';

// ────────────────────────────────────────────────────────────────────
// Row ⇄ Domain converters
// ────────────────────────────────────────────────────────────────────

function safeMetadata(v: unknown): Record<string, unknown> | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'object') return v as Record<string, unknown>;
  return undefined;
}

function rowToDisbursement(row: DisbursementRow): Disbursement {
  return {
    id: row.id,
    tenantId: row.tenantId as TenantId,
    ownerId: row.ownerId as OwnerId,
    amountMinorUnits: row.amountMinorUnits ?? 0,
    currency: row.currency as CurrencyCode,
    status: row.status as DisbursementStatus,
    destination: row.destination,
    destinationType: row.destinationType ?? 'bank_account',
    provider: row.provider ?? undefined,
    transferId: row.transferId ?? undefined,
    providerResponse: safeMetadata(row.providerResponse),
    description: row.description ?? undefined,
    initiatedAt: row.initiatedAt ?? undefined,
    completedAt: row.completedAt ?? undefined,
    failedAt: row.failedAt ?? undefined,
    estimatedArrival: row.estimatedArrival ?? undefined,
    failureReason: row.failureReason ?? undefined,
    failureCode: row.failureCode ?? undefined,
    idempotencyKey: row.idempotencyKey ?? undefined,
    ledgerEntryId: row.ledgerEntryId ?? undefined,
    metadata: safeMetadata(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy ?? undefined,
    updatedBy: row.updatedBy ?? undefined,
  };
}

function disbursementToInsert(
  d: Disbursement,
): typeof disbursements.$inferInsert {
  return {
    id: d.id,
    tenantId: d.tenantId,
    ownerId: d.ownerId,
    amountMinorUnits: d.amountMinorUnits,
    currency: d.currency,
    status: d.status,
    destination: d.destination,
    destinationType: d.destinationType ?? 'bank_account',
    provider: d.provider ?? null,
    transferId: d.transferId ?? null,
    providerResponse: d.providerResponse ?? {},
    description: d.description ?? null,
    initiatedAt: d.initiatedAt ?? null,
    completedAt: d.completedAt ?? null,
    failedAt: d.failedAt ?? null,
    estimatedArrival: d.estimatedArrival ?? null,
    failureReason: d.failureReason ?? null,
    failureCode: d.failureCode ?? null,
    idempotencyKey: d.idempotencyKey ?? null,
    ledgerEntryId: d.ledgerEntryId ?? null,
    metadata: d.metadata ?? {},
    createdBy: d.createdBy ?? null,
    updatedBy: d.updatedBy ?? null,
  };
}

// ────────────────────────────────────────────────────────────────────
// Drizzle repository
// ────────────────────────────────────────────────────────────────────

export class DrizzleDisbursementRepository implements IDisbursementRepository {
  constructor(private readonly db: DatabaseClient) {}

  async create(disbursement: Disbursement): Promise<Disbursement> {
    const inserted = await this.db
      .insert(disbursements)
      .values(disbursementToInsert(disbursement))
      .returning();

    if (!inserted[0]) {
      throw new Error(
        `DrizzleDisbursementRepository.create: insert returned no row for id=${disbursement.id}`,
      );
    }
    return rowToDisbursement(inserted[0]);
  }

  async findById(
    id: string,
    tenantId: TenantId,
  ): Promise<Disbursement | null> {
    const rows = await this.db
      .select()
      .from(disbursements)
      .where(
        and(eq(disbursements.id, id), eq(disbursements.tenantId, tenantId)),
      )
      .limit(1);
    return rows[0] ? rowToDisbursement(rows[0]) : null;
  }

  async findByIdempotencyKey(
    idempotencyKey: string,
    tenantId: TenantId,
  ): Promise<Disbursement | null> {
    const rows = await this.db
      .select()
      .from(disbursements)
      .where(
        and(
          eq(disbursements.idempotencyKey, idempotencyKey),
          eq(disbursements.tenantId, tenantId),
        ),
      )
      .limit(1);
    return rows[0] ? rowToDisbursement(rows[0]) : null;
  }

  async findByTransferId(
    provider: string,
    transferId: string,
  ): Promise<Disbursement | null> {
    // No tenantId at the interface level — the InMemory shape predates
    // multi-tenant unique-index widening. The DB index is on (provider,
    // transfer_id) NOT (tenant_id, provider, transfer_id), so callers
    // MUST treat this as a possibly-multi-row lookup and confirm
    // tenancy at the call site. RLS still enforces tenant isolation
    // at the DB; under the authenticated app role the query never
    // returns rows from another tenant.
    const rows = await this.db
      .select()
      .from(disbursements)
      .where(
        and(
          eq(disbursements.provider, provider),
          eq(disbursements.transferId, transferId),
        ),
      )
      .limit(1);
    return rows[0] ? rowToDisbursement(rows[0]) : null;
  }

  async update(disbursement: Disbursement): Promise<Disbursement> {
    const updates = {
      ownerId: disbursement.ownerId,
      amountMinorUnits: disbursement.amountMinorUnits,
      currency: disbursement.currency,
      status: disbursement.status,
      destination: disbursement.destination,
      destinationType: disbursement.destinationType ?? 'bank_account',
      provider: disbursement.provider ?? null,
      transferId: disbursement.transferId ?? null,
      providerResponse: disbursement.providerResponse ?? {},
      description: disbursement.description ?? null,
      initiatedAt: disbursement.initiatedAt ?? null,
      completedAt: disbursement.completedAt ?? null,
      failedAt: disbursement.failedAt ?? null,
      estimatedArrival: disbursement.estimatedArrival ?? null,
      failureReason: disbursement.failureReason ?? null,
      failureCode: disbursement.failureCode ?? null,
      idempotencyKey: disbursement.idempotencyKey ?? null,
      ledgerEntryId: disbursement.ledgerEntryId ?? null,
      metadata: disbursement.metadata ?? {},
      updatedBy: disbursement.updatedBy ?? null,
      updatedAt: new Date(),
    };

    const updated = await this.db
      .update(disbursements)
      .set(updates)
      .where(
        and(
          eq(disbursements.id, disbursement.id),
          eq(disbursements.tenantId, disbursement.tenantId),
        ),
      )
      .returning();

    if (!updated[0]) {
      throw new Error(
        `DrizzleDisbursementRepository.update: no row updated for id=${disbursement.id}`,
      );
    }
    return rowToDisbursement(updated[0]);
  }

  async find(
    filters: DisbursementFilters,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<DisbursementPaginatedResult> {
    const conditions = [eq(disbursements.tenantId, filters.tenantId)];

    if (filters.ownerId) {
      conditions.push(eq(disbursements.ownerId, filters.ownerId));
    }
    if (filters.status) {
      const ss = Array.isArray(filters.status)
        ? filters.status
        : [filters.status];
      conditions.push(inArray(disbursements.status, ss));
    }
    if (filters.fromDate) {
      conditions.push(gte(disbursements.createdAt, filters.fromDate));
    }
    if (filters.toDate) {
      conditions.push(lte(disbursements.createdAt, filters.toDate));
    }

    const where = and(...conditions);
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.max(1, Math.min(500, Math.floor(pageSize)));
    const offset = (safePage - 1) * safePageSize;

    const [rows, totalRow] = await Promise.all([
      this.db
        .select()
        .from(disbursements)
        .where(where)
        .orderBy(desc(disbursements.createdAt))
        .limit(safePageSize)
        .offset(offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(disbursements)
        .where(where),
    ]);

    const total = Number(totalRow[0]?.total ?? 0);
    return {
      items: rows.map(rowToDisbursement),
      total,
      page: safePage,
      pageSize: safePageSize,
      hasMore: offset + rows.length < total,
    };
  }

  async findByOwner(
    tenantId: TenantId,
    ownerId: OwnerId,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<DisbursementPaginatedResult> {
    return this.find({ tenantId, ownerId }, page, pageSize);
  }

  async findPending(tenantId: TenantId): Promise<Disbursement[]> {
    const rows = await this.db
      .select()
      .from(disbursements)
      .where(
        and(
          eq(disbursements.tenantId, tenantId),
          inArray(disbursements.status, ['PENDING', 'PROCESSING', 'IN_TRANSIT']),
        ),
      )
      .orderBy(desc(disbursements.createdAt));
    return rows.map(rowToDisbursement);
  }

  async findLastByOwner(
    tenantId: TenantId,
    ownerId: OwnerId,
  ): Promise<Disbursement | null> {
    const rows = await this.db
      .select()
      .from(disbursements)
      .where(
        and(
          eq(disbursements.tenantId, tenantId),
          eq(disbursements.ownerId, ownerId),
        ),
      )
      .orderBy(desc(disbursements.createdAt))
      .limit(1);
    return rows[0] ? rowToDisbursement(rows[0]) : null;
  }
}
