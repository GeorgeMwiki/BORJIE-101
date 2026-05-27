/**
 * Drizzle-backed Payment Intent Repository.
 *
 * Production implementation of `IPaymentIntentRepository` against the
 * Drizzle-managed `payment_intents` table (see
 * `packages/database/src/schemas/payments-ledger.schema.ts`). Replaces
 * the unwired Prisma path documented in `repositories/factory.ts`.
 *
 * Closes the A2 BLOCKER from `.audit/deep-audit-2026-05-20.md` for
 * `payment_intents` specifically. The remaining repos (account,
 * ledger, statement, disbursement) follow the same pattern and are
 * tracked for a follow-up wave; see the JSDoc on
 * `createRepositories` for the migration sequencing.
 *
 * Design notes:
 *
 *   - Row → domain conversion is centralised in `rowToPaymentIntent`
 *     so additions to the schema only need one update point.
 *   - We never trust the row's tenant_id implicitly — every read
 *     filters on tenantId in the SQL WHERE so RLS + app-layer
 *     filtering both enforce isolation (defence in depth).
 *   - The Money domain object is reconstructed from the
 *     `amount_minor_units` + `currency` pair returned by Drizzle.
 *   - `update()` writes only the fields the domain aggregator allows
 *     to mutate — id + tenantId + createdAt are intentionally not in
 *     the SET clause.
 *   - Hard DB failures bubble up — the calling service decides whether
 *     to retry. We do NOT swallow errors here.
 */

import { and, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import {
  Money,
  type PaymentIntent,
  type PaymentIntentId,
  type TenantId,
  type CustomerId,
  type LeaseId,
  type CurrencyCode,
} from '@borjie/domain-models';
import { pgTable, text, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';
import { type DatabaseClient } from '@borjie/database';

// Local Drizzle table declaration for the legacy payments-ledger
// `payment_intents` table. The canonical schema was archived in
// `packages/database/.archive/migrations/0167b_payments_ledger_drizzle.sql`
// when the database package pivoted to the mining domain; the repository
// adapter still needs the shape for production deployments that retain
// the table. Declared as a module-internal const so its inferred type
// stays inside this compilation unit. Column-name parity with the
// archived schema is mandatory.
const paymentIntents = pgTable('payment_intents', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  customerId: text('customer_id').notNull(),
  leaseId: text('lease_id'),
  type: text('type').notNull(),
  status: text('status').notNull(),
  amountMinorUnits: integer('amount_minor_units').notNull(),
  currency: text('currency').notNull(),
  platformFeeMinorUnits: integer('platform_fee_minor_units'),
  netAmountMinorUnits: integer('net_amount_minor_units'),
  providerName: text('provider_name'),
  externalId: text('external_id'),
  description: text('description'),
  statementDescriptor: text('statement_descriptor'),
  idempotencyKey: text('idempotency_key'),
  receiptUrl: text('receipt_url'),
  refundedAmountMinorUnits: integer('refunded_amount_minor_units').default(0),
  failureReason: text('failure_reason'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  refundedAt: timestamp('refunded_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
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

type PaymentIntentRow = typeof paymentIntents.$inferSelect;
import type { PaymentStatus } from '../types';
import type {
  IPaymentIntentRepository,
  PaymentIntentFilters,
  PaginatedResult,
} from './payment-intent.repository';

// ────────────────────────────────────────────────────────────────────
// Row ⇄ Domain converters
// ────────────────────────────────────────────────────────────────────

function safeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function rowToPaymentIntent(row: PaymentIntentRow): PaymentIntent {
  // payment_intents.currency is `text NOT NULL` (see payment.schema.ts).
  // Fail loud if a row violates that invariant rather than silently defaulting
  // to a tenant-foreign currency (the old `?? 'KES'` fallback assumed Kenya
  // and was wrong for TZ / NG tenants).
  if (!row.currency) {
    throw new Error(
      `payment_intents.currency invariant violated: row id=${String(row.id)} has empty currency`,
    );
  }
  const currency = row.currency as CurrencyCode;
  const amount = Money.fromMinorUnits(row.amountMinorUnits ?? 0, currency);

  const platformFee =
    row.platformFeeMinorUnits !== null && row.platformFeeMinorUnits !== undefined
      ? Money.fromMinorUnits(row.platformFeeMinorUnits, currency)
      : undefined;

  const netAmount =
    row.netAmountMinorUnits !== null && row.netAmountMinorUnits !== undefined
      ? Money.fromMinorUnits(row.netAmountMinorUnits, currency)
      : undefined;

  const refundedAmount =
    row.refundedAmountMinorUnits !== null &&
    row.refundedAmountMinorUnits !== undefined
      ? Money.fromMinorUnits(row.refundedAmountMinorUnits, currency)
      : undefined;

  return {
    id: row.id as PaymentIntentId,
    tenantId: row.tenantId as TenantId,
    customerId: row.customerId as CustomerId,
    leaseId: (row.leaseId ?? undefined) as LeaseId | undefined,
    type: row.type as PaymentIntent['type'],
    status: row.status as PaymentStatus,
    amount,
    platformFee,
    netAmount,
    description: row.description ?? '',
    externalId: row.externalId ?? undefined,
    providerName: row.providerName ?? undefined,
    idempotencyKey: row.idempotencyKey ?? '',
    paidAt: row.paidAt ?? undefined,
    failureReason: row.failureReason ?? undefined,
    refundedAmount,
    receiptUrl: row.receiptUrl ?? undefined,
    statementDescriptor: row.statementDescriptor ?? undefined,
    metadata: safeMetadata(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } as PaymentIntent;
}

function paymentIntentToInsert(
  pi: PaymentIntent,
): typeof paymentIntents.$inferInsert {
  return {
    id: pi.id,
    tenantId: pi.tenantId,
    customerId: pi.customerId,
    leaseId: pi.leaseId ?? null,
    type: pi.type,
    status: pi.status,
    amountMinorUnits: pi.amount.amountMinorUnits,
    currency: pi.amount.currency,
    platformFeeMinorUnits: pi.platformFee?.amountMinorUnits ?? null,
    netAmountMinorUnits: pi.netAmount?.amountMinorUnits ?? null,
    providerName: pi.providerName ?? null,
    externalId: pi.externalId ?? null,
    description: pi.description ?? null,
    statementDescriptor: pi.statementDescriptor ?? null,
    idempotencyKey: pi.idempotencyKey ?? null,
    receiptUrl: pi.receiptUrl ?? null,
    refundedAmountMinorUnits: pi.refundedAmount?.amountMinorUnits ?? 0,
    failureReason: pi.failureReason ?? null,
    paidAt: pi.paidAt ?? null,
    metadata: pi.metadata ?? {},
  };
}

// ────────────────────────────────────────────────────────────────────
// Drizzle repository
// ────────────────────────────────────────────────────────────────────

export class DrizzlePaymentIntentRepository
  implements IPaymentIntentRepository {
  constructor(private readonly db: DatabaseClient) {}

  async create(paymentIntent: PaymentIntent): Promise<PaymentIntent> {
    const insert = paymentIntentToInsert(paymentIntent);
    const inserted = await this.db
      .insert(paymentIntents)
      .values(insert)
      .returning();

    if (!inserted[0]) {
      throw new Error(
        `DrizzlePaymentIntentRepository.create: insert returned no row for id=${paymentIntent.id}`,
      );
    }
    return rowToPaymentIntent(inserted[0]);
  }

  async findById(
    id: PaymentIntentId,
    tenantId: TenantId,
  ): Promise<PaymentIntent | null> {
    const rows = await this.db
      .select()
      .from(paymentIntents)
      .where(
        and(eq(paymentIntents.id, id), eq(paymentIntents.tenantId, tenantId)),
      )
      .limit(1);

    return rows[0] ? rowToPaymentIntent(rows[0]) : null;
  }

  async findByExternalId(
    externalId: string,
    providerName: string,
    tenantId: TenantId,
  ): Promise<PaymentIntent | null> {
    // SECURITY: tenantId predicate is required to prevent cross-tenant
    // reads. The DB unique index is (tenant_id, provider_name,
    // external_id) per migration 0169, so external_id alone is NOT a
    // global identifier — two tenants may legitimately share the same
    // provider-issued external_id.
    const rows = await this.db
      .select()
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.externalId, externalId),
          eq(paymentIntents.providerName, providerName),
          eq(paymentIntents.tenantId, tenantId),
        ),
      )
      .limit(1);

    return rows[0] ? rowToPaymentIntent(rows[0]) : null;
  }

  async findByIdempotencyKey(
    idempotencyKey: string,
    tenantId: TenantId,
  ): Promise<PaymentIntent | null> {
    const rows = await this.db
      .select()
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.idempotencyKey, idempotencyKey),
          eq(paymentIntents.tenantId, tenantId),
        ),
      )
      .limit(1);

    return rows[0] ? rowToPaymentIntent(rows[0]) : null;
  }

  async update(paymentIntent: PaymentIntent): Promise<PaymentIntent> {
    const updates = {
      status: paymentIntent.status,
      amountMinorUnits: paymentIntent.amount.amountMinorUnits,
      currency: paymentIntent.amount.currency,
      platformFeeMinorUnits: paymentIntent.platformFee?.amountMinorUnits ?? null,
      netAmountMinorUnits: paymentIntent.netAmount?.amountMinorUnits ?? null,
      providerName: paymentIntent.providerName ?? null,
      externalId: paymentIntent.externalId ?? null,
      description: paymentIntent.description ?? null,
      statementDescriptor: paymentIntent.statementDescriptor ?? null,
      receiptUrl: paymentIntent.receiptUrl ?? null,
      refundedAmountMinorUnits:
        paymentIntent.refundedAmount?.amountMinorUnits ?? 0,
      failureReason: paymentIntent.failureReason ?? null,
      paidAt: paymentIntent.paidAt ?? null,
      metadata: paymentIntent.metadata ?? {},
      updatedAt: new Date(),
    };

    const updated = await this.db
      .update(paymentIntents)
      .set(updates)
      .where(
        and(
          eq(paymentIntents.id, paymentIntent.id),
          eq(paymentIntents.tenantId, paymentIntent.tenantId),
        ),
      )
      .returning();

    if (!updated[0]) {
      throw new Error(
        `DrizzlePaymentIntentRepository.update: no row updated for id=${paymentIntent.id}`,
      );
    }
    return rowToPaymentIntent(updated[0]);
  }

  async find(
    filters: PaymentIntentFilters,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<PaginatedResult<PaymentIntent>> {
    const conditions = [eq(paymentIntents.tenantId, filters.tenantId)];

    if (filters.customerId) {
      conditions.push(eq(paymentIntents.customerId, filters.customerId));
    }
    if (filters.leaseId) {
      conditions.push(eq(paymentIntents.leaseId, filters.leaseId));
    }
    if (filters.status) {
      const statuses = Array.isArray(filters.status)
        ? filters.status
        : [filters.status];
      conditions.push(inArray(paymentIntents.status, statuses));
    }
    if (filters.fromDate) {
      conditions.push(gte(paymentIntents.createdAt, filters.fromDate));
    }
    if (filters.toDate) {
      conditions.push(lte(paymentIntents.createdAt, filters.toDate));
    }
    if (filters.currency) {
      conditions.push(eq(paymentIntents.currency, filters.currency));
    }
    if (filters.minAmount !== undefined) {
      conditions.push(
        gte(paymentIntents.amountMinorUnits, filters.minAmount),
      );
    }
    if (filters.maxAmount !== undefined) {
      conditions.push(
        lte(paymentIntents.amountMinorUnits, filters.maxAmount),
      );
    }

    const where = and(...conditions);
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.max(1, Math.min(500, Math.floor(pageSize)));
    const offset = (safePage - 1) * safePageSize;

    const [rows, totalRow] = await Promise.all([
      this.db
        .select()
        .from(paymentIntents)
        .where(where)
        .orderBy(desc(paymentIntents.createdAt))
        .limit(safePageSize)
        .offset(offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(paymentIntents)
        .where(where),
    ]);

    const total = Number(totalRow[0]?.total ?? 0);
    return {
      items: rows.map(rowToPaymentIntent),
      total,
      page: safePage,
      pageSize: safePageSize,
      hasMore: offset + rows.length < total,
    };
  }

  async findPendingByCustomer(
    tenantId: TenantId,
    customerId: CustomerId,
  ): Promise<PaymentIntent[]> {
    const pendingStatuses: PaymentStatus[] = [
      'PENDING',
      'PROCESSING',
      'REQUIRES_ACTION',
    ] as PaymentStatus[];

    const rows = await this.db
      .select()
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.tenantId, tenantId),
          eq(paymentIntents.customerId, customerId),
          inArray(paymentIntents.status, pendingStatuses),
        ),
      );

    return rows.map(rowToPaymentIntent);
  }

  async findSuccessfulByLease(
    tenantId: TenantId,
    leaseId: LeaseId,
    fromDate: Date,
    toDate: Date,
  ): Promise<PaymentIntent[]> {
    const rows = await this.db
      .select()
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.tenantId, tenantId),
          eq(paymentIntents.leaseId, leaseId),
          eq(paymentIntents.status, 'SUCCEEDED'),
          gte(paymentIntents.paidAt, fromDate),
          lte(paymentIntents.paidAt, toDate),
        ),
      );

    return rows.map(rowToPaymentIntent);
  }

  async getTotalPaidByCustomer(
    tenantId: TenantId,
    customerId: CustomerId,
    fromDate: Date,
    toDate: Date,
  ): Promise<number> {
    const result = await this.db
      .select({
        total: sql<number>`COALESCE(SUM(${paymentIntents.amountMinorUnits}), 0)::bigint`,
      })
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.tenantId, tenantId),
          eq(paymentIntents.customerId, customerId),
          eq(paymentIntents.status, 'SUCCEEDED'),
          gte(paymentIntents.paidAt, fromDate),
          lte(paymentIntents.paidAt, toDate),
        ),
      );

    return Number(result[0]?.total ?? 0);
  }

  async findNeedingReconciliation(
    tenantId: TenantId,
    olderThan: Date,
  ): Promise<PaymentIntent[]> {
    const rows = await this.db
      .select()
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.tenantId, tenantId),
          eq(paymentIntents.status, 'PROCESSING'),
          lt(paymentIntents.createdAt, olderThan),
        ),
      );

    return rows.map(rowToPaymentIntent);
  }
}
