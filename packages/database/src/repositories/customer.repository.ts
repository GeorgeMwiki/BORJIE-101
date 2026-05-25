// @ts-nocheck — drizzle-orm v0.36 pgEnum column narrowing: accepts only literal union in eq(); repo params arrive as `string`. Tracked: drizzle-team/drizzle-orm#2389 (pgEnum string narrowing). Revisit after drizzle 0.37 lands widened overloads.
/**
 * CustomerRepository - PostgreSQL implementation for customer data access.
 *
 * Phase D / A2b-1 — Field-level encryption-at-rest is wired here. The
 * repository accepts an optional `EncryptionPort` + audit sink via its
 * constructor; when present, every write is wrapped with `encryptRow()`
 * and every read is wrapped with `decryptRow()` so callers see plaintext
 * at the service boundary but Postgres stores ciphertext for every
 * column the classification registry marks `encryptAtRest: true`
 * (NIDA, KRA PIN, M-Pesa phone, etc.). When `encPort` is omitted the
 * repo degrades to legacy plaintext behaviour — preserves backwards
 * compatibility for tests that do not need encryption.
 */

import { eq, and, desc, isNull, sql, like, or, inArray } from 'drizzle-orm';
import type { DatabaseClient } from '../client.js';
import { customers, leases } from '../schemas/index.js';
import type {
  TenantId,
  UserId,
  PaginationParams,
  PaginatedResult,
  CustomerId,
  PropertyId,
} from '@borjie/domain-models';
import { buildPaginatedResult, DEFAULT_PAGINATION } from './base.repository.js';
import {
  decryptRow,
  decryptRows,
  encryptRow,
  type EncryptionPort,
  type FieldEncryptionAuditSink,
} from '../security/encryption/index.js';
import { assertCustomerStatuses } from './enum-guards.js';

type CustomerRow = typeof customers.$inferSelect;

export interface CustomerFilters {
  status?: string | string[];
  search?: string;
}

export interface RepoEncryptionDeps {
  readonly encPort?: EncryptionPort | null;
  readonly encAudit?: FieldEncryptionAuditSink | null;
}

const CUSTOMERS_TABLE = 'customers';

export class CustomerRepository {
  private readonly encPort: EncryptionPort | null;
  private readonly encAudit: FieldEncryptionAuditSink | null;

  constructor(
    private readonly db: DatabaseClient,
    deps: RepoEncryptionDeps = {},
  ) {
    this.encPort = deps.encPort ?? null;
    this.encAudit = deps.encAudit ?? null;
  }

  private async decryptOne(
    row: CustomerRow | null,
    tenantId: TenantId,
  ): Promise<CustomerRow | null> {
    if (!row || !this.encPort) return row;
    return decryptRow({
      row,
      table: CUSTOMERS_TABLE,
      tenantId: String(tenantId),
      port: this.encPort,
    });
  }

  private async decryptMany(
    rows: CustomerRow[],
    tenantId: TenantId,
  ): Promise<CustomerRow[]> {
    if (!this.encPort || rows.length === 0) return rows;
    return (await decryptRows(rows, {
      table: CUSTOMERS_TABLE,
      tenantId: String(tenantId),
      port: this.encPort,
    })) as CustomerRow[];
  }

  async findById(id: CustomerId, tenantId: TenantId): Promise<CustomerRow | null> {
    const result = await this.db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.id, id),
          eq(customers.tenantId, tenantId),
          isNull(customers.deletedAt)
        )
      )
      .limit(1);
    return this.decryptOne(result[0] ?? null, tenantId);
  }

  /**
   * Wave 25 Agent V: batch fetch many customers by id.
   * Replaces `Promise.all(ids.map(id => findById(id)))` N+1 loops
   * with a single `IN (...)` query.
   */
  async findByIds(ids: CustomerId[], tenantId: TenantId): Promise<CustomerRow[]> {
    if (ids.length === 0) return [];
    const unique = Array.from(new Set(ids));
    const rows = await this.db
      .select()
      .from(customers)
      .where(
        and(
          inArray(customers.id, unique),
          eq(customers.tenantId, tenantId),
          isNull(customers.deletedAt)
        )
      );
    return this.decryptMany(rows, tenantId);
  }

  async findByCode(
    customerCode: string,
    tenantId: TenantId
  ): Promise<CustomerRow | null> {
    const result = await this.db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.customerCode, customerCode),
          eq(customers.tenantId, tenantId),
          isNull(customers.deletedAt)
        )
      )
      .limit(1);
    return this.decryptOne(result[0] ?? null, tenantId);
  }

  /**
   * NOTE: `email` is encrypted-at-rest. A bare `WHERE email = $plaintext`
   * predicate will not find encrypted rows on Postgres. Callers that need
   * to query by email after encryption is wired should look up via a
   * (tenant_id, email_lookup_hash) index — a follow-up migration will add
   * that column. Today this method continues to issue the legacy WHERE
   * so existing tests/back-fill scripts keep working; once the historical
   * back-fill completes (operator runbook `scripts/encrypt-existing-rows`)
   * this method MUST be migrated to the lookup-hash form.
   */
  async findByEmail(
    email: string,
    tenantId: TenantId
  ): Promise<CustomerRow | null> {
    const result = await this.db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.email, email),
          eq(customers.tenantId, tenantId),
          isNull(customers.deletedAt)
        )
      )
      .limit(1);
    return this.decryptOne(result[0] ?? null, tenantId);
  }

  async findMany(
    tenantId: TenantId,
    pagination?: PaginationParams,
    filters?: CustomerFilters
  ): Promise<PaginatedResult<CustomerRow>> {
    const { limit, offset } = pagination ?? DEFAULT_PAGINATION;

    const conditions = [
      eq(customers.tenantId, tenantId),
      isNull(customers.deletedAt),
    ];

    if (filters?.status) {
      // Bug fix A-BUG-DEEP #9: validate against the literal union so a bad
      // status surfaces an explicit ENUM_VALUE_INVALID error rather than a
      // silently empty result set.
      const rawStatuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      const statuses = assertCustomerStatuses(rawStatuses);
      conditions.push(inArray(customers.status, statuses as unknown as typeof customers.status.$inferType[]));
    }

    if (filters?.search) {
      const searchPattern = `%${filters.search}%`;
      conditions.push(
        or(
          like(customers.firstName, searchPattern),
          like(customers.lastName, searchPattern),
          like(customers.email, searchPattern),
          like(customers.phone, searchPattern),
          like(customers.customerCode, searchPattern)
        )!
      );
    }

    const whereClause = and(...conditions);

    const [items, countResult] = await Promise.all([
      this.db
        .select()
        .from(customers)
        .where(whereClause)
        .orderBy(desc(customers.createdAt))
        .limit(limit)
        .offset(offset),
      this.db.select({ count: sql<number>`count(*)::int` }).from(customers).where(whereClause),
    ]);

    const total = countResult[0]?.count ?? 0;
    const decrypted = await this.decryptMany(items, tenantId);
    return buildPaginatedResult(decrypted, total, { limit, offset });
  }

  /**
   * BFF aggregation hot-path: fetch all customers who hold at least one
   * lease against the given properties. Customers themselves are tenant-
   * scoped (no direct `property_id`), so we resolve the link via the
   * `leases` table in a single subquery — replacing the previous
   * `findMany(1000) + JS .filter(customerIds.has)` pattern in
   * `getOwnerScope`.
   */
  async findByPropertyIds(
    propertyIds: PropertyId[],
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<CustomerRow>> {
    if (propertyIds.length === 0) {
      return buildPaginatedResult([], 0, pagination ?? DEFAULT_PAGINATION);
    }
    const { limit, offset } = pagination ?? DEFAULT_PAGINATION;
    const unique = Array.from(new Set(propertyIds));

    // Subquery: distinct customer ids that have an active-or-historical
    // lease pointing at one of the requested properties.
    const customerIdsSubquery = this.db
      .selectDistinct({ customerId: leases.customerId })
      .from(leases)
      .where(
        and(
          inArray(leases.propertyId, unique),
          eq(leases.tenantId, tenantId),
          isNull(leases.deletedAt)
        )
      );

    const whereClause = and(
      eq(customers.tenantId, tenantId),
      isNull(customers.deletedAt),
      inArray(customers.id, customerIdsSubquery)
    );

    const [items, countResult] = await Promise.all([
      this.db
        .select()
        .from(customers)
        .where(whereClause)
        .orderBy(desc(customers.createdAt))
        .limit(limit)
        .offset(offset),
      this.db.select({ count: sql<number>`count(*)::int` }).from(customers).where(whereClause),
    ]);

    const total = countResult[0]?.count ?? 0;
    const decrypted = await this.decryptMany(items, tenantId);
    return buildPaginatedResult(decrypted, total, { limit, offset });
  }

  async create(
    input: typeof customers.$inferInsert,
    createdBy: UserId
  ): Promise<CustomerRow> {
    const encryptedInput = this.encPort
      ? await encryptRow({
          row: { ...input },
          table: CUSTOMERS_TABLE,
          tenantId: input.tenantId ? String(input.tenantId) : null,
          rowId: input.id ? String(input.id) : null,
          port: this.encPort,
          ...(this.encAudit ? { audit: this.encAudit } : {}),
        })
      : input;
    const [row] = await this.db
      .insert(customers)
      .values({
        ...encryptedInput,
        createdBy: createdBy ?? input.createdBy,
        updatedBy: createdBy ?? input.updatedBy,
      })
      .returning();
    if (!row) throw new Error('Failed to create customer');
    return (await this.decryptOne(row, input.tenantId as TenantId)) as CustomerRow;
  }

  async update(
    id: CustomerId,
    tenantId: TenantId,
    input: Partial<typeof customers.$inferInsert>,
    updatedBy: UserId
  ): Promise<CustomerRow> {
    const encryptedPatch = this.encPort
      ? await encryptRow({
          row: { ...input },
          table: CUSTOMERS_TABLE,
          tenantId: String(tenantId),
          rowId: String(id),
          port: this.encPort,
          ...(this.encAudit ? { audit: this.encAudit } : {}),
        })
      : input;
    const [row] = await this.db
      .update(customers)
      .set({
        ...encryptedPatch,
        updatedAt: new Date(),
        updatedBy: updatedBy ?? input.updatedBy,
      })
      .where(
        and(
          eq(customers.id, id),
          eq(customers.tenantId, tenantId)
        )
      )
      .returning();
    if (!row) throw new Error(`Customer not found: ${id}`);
    return (await this.decryptOne(row, tenantId)) as CustomerRow;
  }

  async delete(id: CustomerId, tenantId: TenantId, deletedBy: UserId): Promise<void> {
    await this.db
      .update(customers)
      .set({
        deletedAt: new Date(),
        deletedBy,
        updatedAt: new Date(),
        updatedBy: deletedBy,
      })
      .where(
        and(
          eq(customers.id, id),
          eq(customers.tenantId, tenantId)
        )
      );
  }
}
