// @ts-nocheck — drizzle-orm v0.36 pgEnum column narrowing: accepts only literal union in eq(); repo params arrive as `string`. Tracked: drizzle-team/drizzle-orm#2389 (pgEnum string narrowing). Revisit after drizzle 0.37 lands widened overloads.
/**
 * LeaseRepository - PostgreSQL implementation for lease data access.
 *
 * Phase D / A2b-1 — `leases.tenant_signature_url` is marked
 * `encryptAtRest: true`. The repository accepts an optional
 * `EncryptionPort` + audit sink via its constructor; writes/reads are
 * wrapped so that signature URLs (and any future encryptAtRest columns
 * on `leases`) land as ciphertext on disk.
 */

import { eq, and, desc, isNull, sql, inArray } from 'drizzle-orm';
import type { DatabaseClient } from '../client.js';
import { leases } from '../schemas/index.js';
import type {
  TenantId,
  PropertyId,
  UnitId,
  UserId,
  PaginationParams,
  PaginatedResult,
  CustomerId,
  LeaseId,
} from '@borjie/domain-models';
import { buildPaginatedResult, DEFAULT_PAGINATION } from './base.repository.js';
import {
  decryptRow,
  decryptRows,
  encryptRow,
  type EncryptionPort,
  type FieldEncryptionAuditSink,
} from '../security/encryption/index.js';
import type { RepoEncryptionDeps } from './customer.repository.js';
import { assertLeaseStatuses } from './enum-guards.js';

type LeaseRow = typeof leases.$inferSelect;

const LEASES_TABLE = 'leases';

export interface LeaseFilters {
  status?: string | string[];
  propertyId?: PropertyId;
  unitId?: UnitId;
  customerId?: CustomerId;
}

export class LeaseRepository {
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
    row: LeaseRow | null,
    tenantId: TenantId,
  ): Promise<LeaseRow | null> {
    if (!row || !this.encPort) return row;
    return decryptRow({
      row,
      table: LEASES_TABLE,
      tenantId: String(tenantId),
      port: this.encPort,
    });
  }

  private async decryptMany(
    rows: LeaseRow[],
    tenantId: TenantId,
  ): Promise<LeaseRow[]> {
    if (!this.encPort || rows.length === 0) return rows;
    return (await decryptRows(rows, {
      table: LEASES_TABLE,
      tenantId: String(tenantId),
      port: this.encPort,
    })) as LeaseRow[];
  }

  async findById(id: LeaseId, tenantId: TenantId): Promise<LeaseRow | null> {
    const result = await this.db
      .select()
      .from(leases)
      .where(
        and(
          eq(leases.id, id),
          eq(leases.tenantId, tenantId),
          isNull(leases.deletedAt)
        )
      )
      .limit(1);
    return this.decryptOne(result[0] ?? null, tenantId);
  }

  /**
   * Wave 25 Agent V: batch fetch many leases by id (IN-query) to
   * replace N+1 `Promise.all(ids.map(findById))` loops in enrichment
   * code paths.
   */
  async findByIds(ids: LeaseId[], tenantId: TenantId): Promise<LeaseRow[]> {
    if (ids.length === 0) return [];
    const unique = Array.from(new Set(ids));
    const rows = await this.db
      .select()
      .from(leases)
      .where(
        and(
          inArray(leases.id, unique),
          eq(leases.tenantId, tenantId),
          isNull(leases.deletedAt)
        )
      );
    return this.decryptMany(rows, tenantId);
  }

  async findByNumber(
    leaseNumber: string,
    tenantId: TenantId
  ): Promise<LeaseRow | null> {
    const result = await this.db
      .select()
      .from(leases)
      .where(
        and(
          eq(leases.leaseNumber, leaseNumber),
          eq(leases.tenantId, tenantId),
          isNull(leases.deletedAt)
        )
      )
      .limit(1);
    return this.decryptOne(result[0] ?? null, tenantId);
  }

  async findMany(
    tenantId: TenantId,
    pagination?: PaginationParams,
    filters?: LeaseFilters
  ): Promise<PaginatedResult<LeaseRow>> {
    const { limit, offset } = pagination ?? DEFAULT_PAGINATION;

    const conditions = [
      eq(leases.tenantId, tenantId),
      isNull(leases.deletedAt),
    ];

    if (filters?.status) {
      // Bug fix A-BUG-DEEP #9: validate against the enum literal union so a
      // bad caller value surfaces as ENUM_VALUE_INVALID instead of an empty
      // result silently produced by drizzle's pgEnum string narrowing.
      const rawStatuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      const statuses = assertLeaseStatuses(rawStatuses);
      conditions.push(inArray(leases.status, statuses as unknown as typeof leases.status.$inferType[]));
    }

    if (filters?.propertyId) {
      conditions.push(eq(leases.propertyId, filters.propertyId));
    }

    if (filters?.unitId) {
      conditions.push(eq(leases.unitId, filters.unitId));
    }

    if (filters?.customerId) {
      conditions.push(eq(leases.customerId, filters.customerId));
    }

    const whereClause = and(...conditions);

    const [items, countResult] = await Promise.all([
      this.db
        .select()
        .from(leases)
        .where(whereClause)
        .orderBy(desc(leases.startDate))
        .limit(limit)
        .offset(offset),
      this.db.select({ count: sql<number>`count(*)::int` }).from(leases).where(whereClause),
    ]);

    const total = countResult[0]?.count ?? 0;
    const decrypted = await this.decryptMany(items, tenantId);
    return buildPaginatedResult(decrypted, total, { limit, offset });
  }

  async findByProperty(
    propertyId: PropertyId,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<LeaseRow>> {
    return this.findMany(tenantId, pagination, { propertyId });
  }

  async findByUnit(
    unitId: UnitId,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<LeaseRow>> {
    return this.findMany(tenantId, pagination, { unitId });
  }

  async findByCustomer(
    customerId: CustomerId,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<LeaseRow>> {
    return this.findMany(tenantId, pagination, { customerId });
  }

  /**
   * BFF aggregation hot-path: fetch all leases for a set of properties in
   * one query (single `WHERE property_id IN (...)`), replacing the previous
   * `findMany(tenantId, limit=1000) + JS .filter(propertyIds.has)` pattern
   * in `getOwnerScope`. Tenant + soft-delete are always enforced.
   */
  async findByPropertyIds(
    propertyIds: PropertyId[],
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<LeaseRow>> {
    if (propertyIds.length === 0) {
      return buildPaginatedResult([], 0, pagination ?? DEFAULT_PAGINATION);
    }
    const { limit, offset } = pagination ?? DEFAULT_PAGINATION;
    const unique = Array.from(new Set(propertyIds));
    const whereClause = and(
      inArray(leases.propertyId, unique),
      eq(leases.tenantId, tenantId),
      isNull(leases.deletedAt)
    );

    const [items, countResult] = await Promise.all([
      this.db
        .select()
        .from(leases)
        .where(whereClause)
        .orderBy(desc(leases.startDate))
        .limit(limit)
        .offset(offset),
      this.db.select({ count: sql<number>`count(*)::int` }).from(leases).where(whereClause),
    ]);

    const total = countResult[0]?.count ?? 0;
    const decrypted = await this.decryptMany(items, tenantId);
    return buildPaginatedResult(decrypted, total, { limit, offset });
  }

  async create(
    input: typeof leases.$inferInsert,
    createdBy: UserId
  ): Promise<LeaseRow> {
    const encryptedInput = this.encPort
      ? await encryptRow({
          row: { ...input },
          table: LEASES_TABLE,
          tenantId: input.tenantId ? String(input.tenantId) : null,
          rowId: input.id ? String(input.id) : null,
          port: this.encPort,
          ...(this.encAudit ? { audit: this.encAudit } : {}),
        })
      : input;
    const [row] = await this.db
      .insert(leases)
      .values({
        ...encryptedInput,
        createdBy: createdBy ?? input.createdBy,
        updatedBy: createdBy ?? input.updatedBy,
      })
      .returning();
    if (!row) throw new Error('Failed to create lease');
    return (await this.decryptOne(row, input.tenantId as TenantId)) as LeaseRow;
  }

  async update(
    id: LeaseId,
    tenantId: TenantId,
    input: Partial<typeof leases.$inferInsert>,
    updatedBy: UserId
  ): Promise<LeaseRow> {
    const encryptedPatch = this.encPort
      ? await encryptRow({
          row: { ...input },
          table: LEASES_TABLE,
          tenantId: String(tenantId),
          rowId: String(id),
          port: this.encPort,
          ...(this.encAudit ? { audit: this.encAudit } : {}),
        })
      : input;
    const [row] = await this.db
      .update(leases)
      .set({
        ...encryptedPatch,
        updatedAt: new Date(),
        updatedBy: updatedBy ?? input.updatedBy,
      })
      .where(
        and(
          eq(leases.id, id),
          eq(leases.tenantId, tenantId)
        )
      )
      .returning();
    if (!row) throw new Error(`Lease not found: ${id}`);
    return (await this.decryptOne(row, tenantId)) as LeaseRow;
  }

  async delete(id: LeaseId, tenantId: TenantId, deletedBy: UserId): Promise<void> {
    await this.db
      .update(leases)
      .set({
        deletedAt: new Date(),
        deletedBy,
        updatedAt: new Date(),
        updatedBy: deletedBy,
      })
      .where(
        and(
          eq(leases.id, id),
          eq(leases.tenantId, tenantId)
        )
      );
  }
}
