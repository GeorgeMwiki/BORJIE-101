// @ts-nocheck — drizzle-orm v0.36 pgEnum column narrowing: accepts only literal union in eq(); repo params arrive as `string`. Tracked: drizzle-team/drizzle-orm#2389 (pgEnum string narrowing). Revisit after drizzle 0.37 lands widened overloads.
/**
 * Payment Repository Implementations
 * PostgreSQL implementations for Invoice, Payment, and Transaction persistence
 */

import {
  eq,
  and,
  desc,
  isNull,
  lt,
  notInArray,
  count,
  max,
  inArray,
  sql,
  sum,
} from 'drizzle-orm';
import type { DatabaseClient } from '../client.js';
import { invoices, payments, transactions, leases } from '../schemas/index.js';
import type { TenantId, PropertyId } from '@borjie/domain-models';
import {
  decryptRow,
  decryptRows,
  encryptRow,
  type EncryptionPort,
  type FieldEncryptionAuditSink,
} from '../security/encryption/index.js';
import type { RepoEncryptionDeps } from './customer.repository.js';

const NON_OVERDUE_INVOICE_STATUSES = ['paid', 'cancelled', 'void'] as const;

const PAYMENTS_TABLE = 'payments';

// ============================================================================
// InvoiceRepository
// ============================================================================

export class InvoiceRepository {
  constructor(private db: DatabaseClient, _deps: RepoEncryptionDeps = {}) {}

  async findMany(tenantId: TenantId, limit = 50, offset = 0) {
    const rows = await this.db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          isNull(invoices.deletedAt)
        )
      )
      .orderBy(desc(invoices.createdAt))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          isNull(invoices.deletedAt)
        )
      );
    return { items: rows, total, limit, offset, hasMore: offset + rows.length < total };
  }

  async findById(id: string, tenantId: TenantId) {
    const rows = await this.db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId), isNull(invoices.deletedAt)));
    return rows[0] ?? null;
  }

  async findByNumber(invoiceNumber: string, tenantId: TenantId) {
    const rows = await this.db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.invoiceNumber, invoiceNumber),
          eq(invoices.tenantId, tenantId),
          isNull(invoices.deletedAt)
        )
      );
    return rows[0] ?? null;
  }

  async findByCustomer(customerId: string, tenantId: TenantId, limit = 50, offset = 0) {
    const rows = await this.db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.customerId, customerId),
          eq(invoices.tenantId, tenantId),
          isNull(invoices.deletedAt)
        )
      )
      .orderBy(desc(invoices.createdAt))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(invoices)
      .where(
        and(
          eq(invoices.customerId, customerId),
          eq(invoices.tenantId, tenantId),
          isNull(invoices.deletedAt)
        )
      );
    return { items: rows, total, limit, offset, hasMore: offset + rows.length < total };
  }

  async findByLease(leaseId: string, tenantId: TenantId, limit = 50, offset = 0) {
    const rows = await this.db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.leaseId, leaseId),
          eq(invoices.tenantId, tenantId),
          isNull(invoices.deletedAt)
        )
      )
      .orderBy(desc(invoices.createdAt))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(invoices)
      .where(
        and(
          eq(invoices.leaseId, leaseId),
          eq(invoices.tenantId, tenantId),
          isNull(invoices.deletedAt)
        )
      );
    return { items: rows, total, limit, offset, hasMore: offset + rows.length < total };
  }

  /**
   * BFF aggregation hot-path: fetch all invoices across a set of
   * properties in one query — replaces the per-tenant `findMany(1000)`
   * scan + JS filter used by `getOwnerScope`. `invoices.property_id` is
   * a real FK column so this is a simple `IN (...)`.
   */
  async findByPropertyIds(
    propertyIds: PropertyId[],
    tenantId: TenantId,
    limit = 50,
    offset = 0
  ) {
    if (propertyIds.length === 0) {
      return { items: [], total: 0, limit, offset, hasMore: false };
    }
    const unique = Array.from(new Set(propertyIds));
    const whereClause = and(
      inArray(invoices.propertyId, unique),
      eq(invoices.tenantId, tenantId),
      isNull(invoices.deletedAt)
    );
    const rows = await this.db
      .select()
      .from(invoices)
      .where(whereClause)
      .orderBy(desc(invoices.createdAt))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(invoices)
      .where(whereClause);
    return { items: rows, total, limit, offset, hasMore: offset + rows.length < total };
  }

  /**
   * Sum the unpaid balance (amount_due) for a customer in one query —
   * the customer-balance endpoint previously fetched whole-tenant invoices
   * and summed in JS. `paid` / `cancelled` / `void` are excluded.
   */
  async sumBalanceByCustomer(
    customerId: string,
    tenantId: TenantId
  ): Promise<number> {
    const rows = await this.db
      .select({
        total: sql<string>`COALESCE(SUM(${invoices.amountDue}), 0)::text`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.customerId, customerId),
          eq(invoices.tenantId, tenantId),
          isNull(invoices.deletedAt),
          notInArray(invoices.status, [...NON_OVERDUE_INVOICE_STATUSES])
        )
      );
    const raw = rows[0]?.total ?? '0';
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  async findByStatus(status: string, tenantId: TenantId, limit = 50, offset = 0) {
    const rows = await this.db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.status, status),
          eq(invoices.tenantId, tenantId),
          isNull(invoices.deletedAt)
        )
      )
      .orderBy(desc(invoices.createdAt))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(invoices)
      .where(
        and(
          eq(invoices.status, status),
          eq(invoices.tenantId, tenantId),
          isNull(invoices.deletedAt)
        )
      );
    return { items: rows, total, limit, offset, hasMore: offset + rows.length < total };
  }

  /**
   * Wave 25 Agent V: added a hard safety LIMIT. The previous
   * implementation had no cap — a large tenant with thousands of
   * overdue invoices would OOM the gateway when `/invoices/overdue`
   * tried to materialize the whole set. `maxRows` defaults to 1000
   * (matches other 1000-cap dashboards) and callers page in-memory.
   * Callers that need cursor semantics should use `findByStatus`
   * plus `findMany` with pagination instead.
   */
  async findOverdue(tenantId: TenantId, maxRows = 1000) {
    return this.db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          lt(invoices.dueDate, new Date()),
          isNull(invoices.deletedAt),
          notInArray(invoices.status, [...NON_OVERDUE_INVOICE_STATUSES])
        )
      )
      .orderBy(desc(invoices.dueDate))
      .limit(maxRows);
  }

  async create(data: typeof invoices.$inferInsert) {
    const [row] = await this.db.insert(invoices).values(data).returning();
    return row!;
  }

  async update(id: string, tenantId: TenantId, data: Partial<typeof invoices.$inferInsert>) {
    const [row] = await this.db
      .update(invoices)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)))
      .returning();
    return row ?? null;
  }

  async delete(id: string, tenantId: TenantId, deletedBy: string) {
    await this.db
      .update(invoices)
      .set({ deletedAt: new Date(), deletedBy })
      .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)));
  }

  async getNextSequence(tenantId: TenantId): Promise<number> {
    const [{ count: c }] = await this.db
      .select({ count: count() })
      .from(invoices)
      .where(eq(invoices.tenantId, tenantId));
    return (c ?? 0) + 1;
  }
}

// ============================================================================
// PaymentRepository
// ============================================================================

export class PaymentRepository {
  private readonly encPort: EncryptionPort | null;
  private readonly encAudit: FieldEncryptionAuditSink | null;

  constructor(private db: DatabaseClient, deps: RepoEncryptionDeps = {}) {
    this.encPort = deps.encPort ?? null;
    this.encAudit = deps.encAudit ?? null;
  }

  private async decryptOne<T extends Record<string, unknown>>(
    row: T | null | undefined,
    tenantId: TenantId,
  ): Promise<T | null> {
    if (!row || !this.encPort) return (row as T | null) ?? null;
    return decryptRow({
      row,
      table: PAYMENTS_TABLE,
      tenantId: String(tenantId),
      port: this.encPort,
    });
  }

  private async decryptMany<T extends Record<string, unknown>>(
    rows: T[],
    tenantId: TenantId,
  ): Promise<T[]> {
    if (!this.encPort || rows.length === 0) return rows;
    return (await decryptRows(rows, {
      table: PAYMENTS_TABLE,
      tenantId: String(tenantId),
      port: this.encPort,
    })) as T[];
  }

  async findMany(tenantId: TenantId, limit = 50, offset = 0) {
    const rows = await this.db
      .select()
      .from(payments)
      .where(eq(payments.tenantId, tenantId))
      .orderBy(desc(payments.createdAt))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(payments)
      .where(eq(payments.tenantId, tenantId));
    const decrypted = await this.decryptMany(rows, tenantId);
    return { items: decrypted, total, limit, offset, hasMore: offset + rows.length < total };
  }

  async findById(id: string, tenantId: TenantId) {
    const rows = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.id, id), eq(payments.tenantId, tenantId)));
    return this.decryptOne(rows[0], tenantId);
  }

  async findByNumber(paymentNumber: string, tenantId: TenantId) {
    const rows = await this.db
      .select()
      .from(payments)
      .where(
        and(eq(payments.paymentNumber, paymentNumber), eq(payments.tenantId, tenantId))
      );
    return this.decryptOne(rows[0], tenantId);
  }

  async findByCustomer(customerId: string, tenantId: TenantId, limit = 50, offset = 0) {
    const rows = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.customerId, customerId), eq(payments.tenantId, tenantId)))
      .orderBy(desc(payments.createdAt))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(payments)
      .where(and(eq(payments.customerId, customerId), eq(payments.tenantId, tenantId)));
    const decrypted = await this.decryptMany(rows, tenantId);
    return { items: decrypted, total, limit, offset, hasMore: offset + rows.length < total };
  }

  async findByInvoice(invoiceId: string, tenantId: TenantId) {
    const rows = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.invoiceId, invoiceId),
          eq(payments.tenantId, tenantId)
        )
      )
      .orderBy(desc(payments.createdAt));
    return this.decryptMany(rows, tenantId);
  }

  /**
   * BFF aggregation hot-path: fetch payments associated with any lease
   * that belongs to the given property scope. Payments do not carry a
   * direct `property_id`, so we resolve the link via the `leases.id IN
   * (lease ids for these properties)` subquery — replaces the per-tenant
   * `findMany(1000) + JS .filter` pattern in `getOwnerScope`.
   */
  async findByPropertyIds(
    propertyIds: PropertyId[],
    tenantId: TenantId,
    limit = 50,
    offset = 0
  ) {
    if (propertyIds.length === 0) {
      return { items: [], total: 0, limit, offset, hasMore: false };
    }
    const unique = Array.from(new Set(propertyIds));

    // Subquery: lease ids whose property_id is in scope.
    const leaseIdsSubquery = this.db
      .select({ id: leases.id })
      .from(leases)
      .where(
        and(
          inArray(leases.propertyId, unique),
          eq(leases.tenantId, tenantId),
          isNull(leases.deletedAt)
        )
      );

    const whereClause = and(
      eq(payments.tenantId, tenantId),
      inArray(payments.leaseId, leaseIdsSubquery)
    );

    const rows = await this.db
      .select()
      .from(payments)
      .where(whereClause)
      .orderBy(desc(payments.createdAt))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(payments)
      .where(whereClause);
    const decrypted = await this.decryptMany(rows, tenantId);
    return { items: decrypted, total, limit, offset, hasMore: offset + rows.length < total };
  }

  async findByStatus(status: string, tenantId: TenantId, limit = 50, offset = 0) {
    const rows = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.status, status), eq(payments.tenantId, tenantId)))
      .orderBy(desc(payments.createdAt))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(payments)
      .where(and(eq(payments.status, status), eq(payments.tenantId, tenantId)));
    const decrypted = await this.decryptMany(rows, tenantId);
    return { items: decrypted, total, limit, offset, hasMore: offset + rows.length < total };
  }

  /**
   * Wave 25 Agent V: added hard safety LIMIT (default 1000). Previously
   * unbounded — a large tenant would load thousands of payments into
   * memory.
   */
  async findByProvider(provider: string, tenantId: TenantId, maxRows = 1000) {
    const rows = await this.db
      .select()
      .from(payments)
      .where(
        and(eq(payments.provider, provider), eq(payments.tenantId, tenantId))
      )
      .orderBy(desc(payments.createdAt))
      .limit(maxRows);
    return this.decryptMany(rows, tenantId);
  }

  async create(data: typeof payments.$inferInsert) {
    const encryptedInput = this.encPort
      ? await encryptRow({
          row: { ...data },
          table: PAYMENTS_TABLE,
          tenantId: data.tenantId ? String(data.tenantId) : null,
          rowId: data.id ? String(data.id) : null,
          port: this.encPort,
          ...(this.encAudit ? { audit: this.encAudit } : {}),
        })
      : data;
    const [row] = await this.db.insert(payments).values(encryptedInput).returning();
    return (await this.decryptOne(row!, data.tenantId as TenantId))!;
  }

  async update(id: string, tenantId: TenantId, data: Partial<typeof payments.$inferInsert>) {
    const encryptedPatch = this.encPort
      ? await encryptRow({
          row: { ...data },
          table: PAYMENTS_TABLE,
          tenantId: String(tenantId),
          rowId: String(id),
          port: this.encPort,
          ...(this.encAudit ? { audit: this.encAudit } : {}),
        })
      : data;
    const [row] = await this.db
      .update(payments)
      .set({ ...encryptedPatch, updatedAt: new Date() })
      .where(and(eq(payments.id, id), eq(payments.tenantId, tenantId)))
      .returning();
    return this.decryptOne(row, tenantId);
  }

  async getNextSequence(tenantId: TenantId): Promise<number> {
    const [{ count: c }] = await this.db
      .select({ count: count() })
      .from(payments)
      .where(eq(payments.tenantId, tenantId));
    return (c ?? 0) + 1;
  }
}

// ============================================================================
// TransactionRepository (Immutable)
// ============================================================================

export class TransactionRepository {
  constructor(private db: DatabaseClient, _deps: RepoEncryptionDeps = {}) {}

  async findById(id: string, tenantId: TenantId) {
    const rows = await this.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.tenantId, tenantId)));
    return rows[0] ?? null;
  }

  async findByCustomer(customerId: string, tenantId: TenantId, limit = 50, offset = 0) {
    const rows = await this.db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.customerId, customerId),
          eq(transactions.tenantId, tenantId)
        )
      )
      .orderBy(desc(transactions.sequenceNumber))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(transactions)
      .where(
        and(
          eq(transactions.customerId, customerId),
          eq(transactions.tenantId, tenantId)
        )
      );
    return { items: rows, total, limit, offset, hasMore: offset + rows.length < total };
  }

  async findByLease(leaseId: string, tenantId: TenantId, limit = 50, offset = 0) {
    const rows = await this.db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.leaseId, leaseId),
          eq(transactions.tenantId, tenantId)
        )
      )
      .orderBy(desc(transactions.sequenceNumber))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(transactions)
      .where(
        and(
          eq(transactions.leaseId, leaseId),
          eq(transactions.tenantId, tenantId)
        )
      );
    return { items: rows, total, limit, offset, hasMore: offset + rows.length < total };
  }

  async findByInvoice(invoiceId: string, tenantId: TenantId) {
    return this.db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.invoiceId, invoiceId),
          eq(transactions.tenantId, tenantId)
        )
      )
      .orderBy(transactions.sequenceNumber);
  }

  async create(data: typeof transactions.$inferInsert) {
    const [row] = await this.db.insert(transactions).values(data).returning();
    return row!;
  }

  async getNextSequence(tenantId: TenantId, customerId?: string): Promise<number> {
    if (customerId) {
      const [{ maxSeq }] = await this.db
        .select({ maxSeq: max(transactions.sequenceNumber) })
        .from(transactions)
        .where(
          and(
            eq(transactions.tenantId, tenantId),
            eq(transactions.customerId, customerId)
          )
        );
      return (maxSeq ?? 0) + 1;
    }
    const [{ count: c }] = await this.db
      .select({ count: count() })
      .from(transactions)
      .where(eq(transactions.tenantId, tenantId));
    return (c ?? 0) + 1;
  }

  async calculateBalance(customerId: string, tenantId: TenantId): Promise<number> {
    const rows = await this.db
      .select({
        balanceAfter: transactions.balanceAfter,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.customerId, customerId),
          eq(transactions.tenantId, tenantId)
        )
      )
      .orderBy(desc(transactions.sequenceNumber))
      .limit(1);
    return rows[0]?.balanceAfter ?? 0;
  }
}
