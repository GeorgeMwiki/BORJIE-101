/**
 * Drizzle-backed Disbursement Repository.
 *
 * Production implementation of `IDisbursementRepository` against the
 * Drizzle-managed `disbursements` table (declared in
 * `packages/database/src/schemas/ledger.schema.ts`).
 *
 * Design notes:
 *
 *   - Tenant predicate is on EVERY query. RLS (migration 0165) is
 *     the belt; this repo is suspenders.
 *   - GUC-BOUND EVERY OP (F1). `disbursements` is FORCE-RLS with the
 *     policy `tenant_id = current_setting('app.current_tenant_id', true)`.
 *     The B2C result webhook runs OUTSIDE tenant context (webhooks are
 *     excluded from auth), so the pooled connection carries a stale/empty
 *     GUC. Every method therefore binds `app.current_tenant_id`
 *     TRANSACTION-LOCALLY (`set_config(..., true)`) as the first statement —
 *     identical to `DrizzleLedgerRepository.postJournalAtomic`. We cannot
 *     import `@borjie/database`'s `withTenantContext`: the package's
 *     `exports` map only exposes `.` / `./schemas` / `./repositories`, so the
 *     `./rls` subpath is unreachable under NodeNext. We inline the same
 *     contract here.
 *   - `findByTransferId` mirrors `DrizzlePaymentIntentRepository.
 *     findByExternalId`: tenantId is REQUIRED. The DB index is now the UNIQUE
 *     (tenant_id, provider, transfer_id) from migration 0165, so a transfer
 *     id can resolve to AT MOST one row per tenant and never to another
 *     tenant's disbursement.
 *   - `resolveTenantById` (F1) is the ONLY cross-tenant read: it discovers a
 *     disbursement's owning tenant from its globally-unique primary key when
 *     the webhook does not yet know the tenant (the `disb-<id>` originator).
 *     It runs under the `service_role_bypass` GUC (migration 0165) and is
 *     keyed on the unguessable UUID PK, so it returns exactly that one row.
 *     The caller then binds the discovered tenant for every subsequent op.
 *   - Idempotency: unique index `disbursements_idempotency_idx` on
 *     (tenant_id, idempotency_key) is the DB enforcement.
 *   - `find` accepts pagination clamped to 1-500.
 */

import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { CurrencyCode, OwnerId, TenantId } from '@borjie/domain-models';
import { pgTable, text, timestamp, bigint, jsonb } from 'drizzle-orm/pg-core';
import { type DatabaseClient } from '@borjie/database';

// Local Drizzle table declaration for the legacy payments-ledger
// `disbursements` table. The canonical schema was archived in
// `packages/database/.archive/migrations/0167b_payments_ledger_drizzle.sql`
// when the database package pivoted to the mining domain; the repository
// adapter still needs the shape for production deployments that retain
// the table. Declared as a module-internal const so its inferred type
// stays inside this compilation unit. Column-name parity with the
// archived schema is mandatory.
const disbursements = pgTable('disbursements', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  ownerId: text('owner_id').notNull(),
  // C2 — overflow safety: BIGINT money column (mode 'number').
  amountMinorUnits: bigint('amount_minor_units', { mode: 'number' }).notNull(),
  currency: text('currency').notNull(),
  status: text('status').notNull(),
  destination: text('destination').notNull(),
  destinationType: text('destination_type').notNull().default('bank_account'),
  provider: text('provider'),
  transferId: text('transfer_id'),
  providerResponse: jsonb('provider_response').default({}),
  description: text('description'),
  initiatedAt: timestamp('initiated_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  failedAt: timestamp('failed_at', { withTimezone: true }),
  estimatedArrival: timestamp('estimated_arrival', { withTimezone: true }),
  failureReason: text('failure_reason'),
  failureCode: text('failure_code'),
  idempotencyKey: text('idempotency_key'),
  ledgerEntryId: text('ledger_entry_id'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
});

type DisbursementRow = typeof disbursements.$inferSelect;
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

  /**
   * Run `fn` inside a transaction with `app.current_tenant_id` bound to
   * `tenantId` TRANSACTION-LOCALLY (mirrors the ledger repo). FORCE RLS on
   * `disbursements` evaluates the policy against this GUC, so without the
   * bind every statement fails closed under the app role — and on a pooled
   * connection that inherited a stale GUC it would silently scope to the
   * WRONG tenant. The `true` third arg of `set_config` scopes the binding to
   * THIS transaction so it can never leak across pooled connections. We also
   * mirror the legacy `app.tenant_id` GUC for older migration helpers, and
   * pin `app.is_service_role='false'` so a stale bypass cannot leak in.
   */
  private async withTenant<T>(
    tenantId: TenantId,
    fn: (tx: DatabaseClient) => Promise<T>,
  ): Promise<T> {
    return (
      this.db as unknown as {
        transaction: <R>(cb: (tx: unknown) => Promise<R>) => Promise<R>;
      }
    ).transaction(async (tx) => {
      const txDb = tx as DatabaseClient;
      await txDb.execute(
        sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`,
      );
      await txDb.execute(
        sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
      );
      await txDb.execute(
        sql`SELECT set_config('app.is_service_role', 'false', true)`,
      );
      return fn(txDb);
    });
  }

  /**
   * F1 — cross-tenant tenant resolution. Discover a disbursement's owning
   * tenant from its globally-unique primary key, BEFORE we know the tenant.
   * Bound to the `service_role_bypass` GUC (`app.is_service_role='true'`,
   * policy from migration 0165) so the read is not blocked by the per-tenant
   * policy; keyed on the unguessable UUID PK so it returns exactly that one
   * row. This is the ONLY method that reads across tenants, and it returns
   * just the tenant id — never row contents to an unauthenticated caller.
   */
  async resolveTenantById(id: string): Promise<{ tenantId: TenantId } | null> {
    const rows = await (
      this.db as unknown as {
        transaction: <R>(cb: (tx: unknown) => Promise<R>) => Promise<R>;
      }
    ).transaction(async (tx) => {
      const txDb = tx as DatabaseClient;
      // Placeholder tenant GUC so it is never empty (avoids accidental
      // tenant_id IS NULL matches); the bypass policy short-circuits before
      // the tenant predicate is evaluated.
      await txDb.execute(
        sql`SELECT set_config('app.current_tenant_id', '__system__', true)`,
      );
      await txDb.execute(
        sql`SELECT set_config('app.tenant_id', '__system__', true)`,
      );
      await txDb.execute(
        sql`SELECT set_config('app.is_service_role', 'true', true)`,
      );
      return txDb
        .select({ tenantId: disbursements.tenantId })
        .from(disbursements)
        .where(eq(disbursements.id, id))
        .limit(1);
    });
    return rows[0] ? { tenantId: rows[0].tenantId as TenantId } : null;
  }

  async create(disbursement: Disbursement): Promise<Disbursement> {
    return this.withTenant(disbursement.tenantId, async (txDb) => {
      const inserted = await txDb
        .insert(disbursements)
        .values(disbursementToInsert(disbursement))
        .returning();

      if (!inserted[0]) {
        throw new Error(
          `DrizzleDisbursementRepository.create: insert returned no row for id=${disbursement.id}`,
        );
      }
      return rowToDisbursement(inserted[0]);
    });
  }

  async findById(
    id: string,
    tenantId: TenantId,
  ): Promise<Disbursement | null> {
    return this.withTenant(tenantId, async (txDb) => {
      const rows = await txDb
        .select()
        .from(disbursements)
        .where(
          and(eq(disbursements.id, id), eq(disbursements.tenantId, tenantId)),
        )
        .limit(1);
      return rows[0] ? rowToDisbursement(rows[0]) : null;
    });
  }

  async findByIdempotencyKey(
    idempotencyKey: string,
    tenantId: TenantId,
  ): Promise<Disbursement | null> {
    return this.withTenant(tenantId, async (txDb) => {
      const rows = await txDb
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
    });
  }

  async findByTransferId(
    provider: string,
    transferId: string,
    tenantId: TenantId,
  ): Promise<Disbursement | null> {
    // F1 — REQUIRES tenantId. The DB index is the UNIQUE
    // (tenant_id, provider, transfer_id) from migration 0165, so this
    // resolves to AT MOST one row for the bound tenant and never to another
    // tenant's disbursement. The tenant predicate is the belt; the
    // GUC-bound RLS policy is the suspenders.
    return this.withTenant(tenantId, async (txDb) => {
      const rows = await txDb
        .select()
        .from(disbursements)
        .where(
          and(
            eq(disbursements.provider, provider),
            eq(disbursements.transferId, transferId),
            eq(disbursements.tenantId, tenantId),
          ),
        )
        .limit(1);
      return rows[0] ? rowToDisbursement(rows[0]) : null;
    });
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

    return this.withTenant(disbursement.tenantId, async (txDb) => {
      const updated = await txDb
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
    });
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

    return this.withTenant(filters.tenantId, async (txDb) => {
      // Sequential (not Promise.all): both run on the SAME tx connection, so
      // they must not race for the single checked-out postgres-js connection.
      const rows = await txDb
        .select()
        .from(disbursements)
        .where(where)
        .orderBy(desc(disbursements.createdAt))
        .limit(safePageSize)
        .offset(offset);
      const totalRow = await txDb
        .select({ total: sql<number>`count(*)::int` })
        .from(disbursements)
        .where(where);

      const total = Number(totalRow[0]?.total ?? 0);
      return {
        items: rows.map(rowToDisbursement),
        total,
        page: safePage,
        pageSize: safePageSize,
        hasMore: offset + rows.length < total,
      };
    });
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
    return this.withTenant(tenantId, async (txDb) => {
      const rows = await txDb
        .select()
        .from(disbursements)
        .where(
          and(
            eq(disbursements.tenantId, tenantId),
            // NEEDS_REVERSAL (EDGE-HARDENING #6) is retryable — surfaced to
            // the reconciliation job alongside the in-flight statuses.
            inArray(disbursements.status, [
              'PENDING',
              'PROCESSING',
              'IN_TRANSIT',
              'NEEDS_REVERSAL',
            ]),
          ),
        )
        .orderBy(desc(disbursements.createdAt));
      return rows.map(rowToDisbursement);
    });
  }

  async findLastByOwner(
    tenantId: TenantId,
    ownerId: OwnerId,
  ): Promise<Disbursement | null> {
    return this.withTenant(tenantId, async (txDb) => {
      const rows = await txDb
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
    });
  }
}
