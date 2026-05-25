// @ts-nocheck — drizzle-orm v0.36 pgEnum column narrowing: accepts only literal union in eq(); repo params arrive as `string`. Tracked: drizzle-team/drizzle-orm#2389 (pgEnum string narrowing). Revisit after drizzle 0.37 lands widened overloads.
/**
 * TenantRepository & UserRepository - PostgreSQL implementations for tenant and user data access.
 *
 * Phase D / A2b-1 — `users.email`, `users.phone`, `users.password_hash`,
 * `users.mfa_secret` are marked `encryptAtRest: true` in the
 * classification registry. The repository accepts an optional
 * `EncryptionPort` + audit sink via its constructor; when present,
 * every write/read of the `users` table is wrapped so the on-disk
 * representation is ciphertext. `tenants` table currently has no
 * encryptAtRest columns in the registry but the port is plumbed in
 * for symmetry / forward-compat.
 */

import { eq, and, desc, isNull, sql, like, or, count } from 'drizzle-orm';
import type { DatabaseClient } from '../client.js';
import { tenants, users } from '../schemas/index.js';
import type {
  TenantId,
  UserId,
  PaginationParams,
  PaginatedResult,
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
import { assertUserStatus } from './enum-guards.js';

type TenantRow = typeof tenants.$inferSelect;

const USERS_TABLE = 'users';

export class TenantRepository {
  constructor(
    private readonly db: DatabaseClient,
    _deps: RepoEncryptionDeps = {},
  ) {
    // tenants currently has no encrypt-at-rest columns; constructor
    // accepts deps for symmetry so callers can pass the same shape.
  }

  async findById(id: TenantId): Promise<TenantRow | null> {
    const result = await this.db
      .select()
      .from(tenants)
      .where(and(eq(tenants.id, id), isNull(tenants.deletedAt)))
      .limit(1);
    return result[0] ?? null;
  }

  async findBySlug(slug: string): Promise<TenantRow | null> {
    const result = await this.db
      .select()
      .from(tenants)
      .where(and(eq(tenants.slug, slug), isNull(tenants.deletedAt)))
      .limit(1);
    return result[0] ?? null;
  }

  async findMany(pagination?: PaginationParams): Promise<PaginatedResult<TenantRow>> {
    const { limit, offset } = pagination ?? DEFAULT_PAGINATION;

    const [items, countResult] = await Promise.all([
      this.db
        .select()
        .from(tenants)
        .where(isNull(tenants.deletedAt))
        .orderBy(desc(tenants.createdAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(tenants)
        .where(isNull(tenants.deletedAt)),
    ]);

    const total = countResult[0]?.count ?? 0;
    return buildPaginatedResult(items, total, { limit, offset });
  }

  async findWithUsage(id: TenantId): Promise<TenantRow | null> {
    const result = await this.db
      .select()
      .from(tenants)
      .where(and(eq(tenants.id, id), isNull(tenants.deletedAt)))
      .limit(1);
    return result[0] ?? null;
  }

  async create(
    input: typeof tenants.$inferInsert,
    createdBy: UserId
  ): Promise<TenantRow> {
    const [row] = await this.db
      .insert(tenants)
      .values({
        ...input,
        createdBy: createdBy ?? input.createdBy,
        updatedBy: createdBy ?? input.updatedBy,
      })
      .returning();
    if (!row) throw new Error('Failed to create tenant');
    return row;
  }

  async update(
    id: TenantId,
    input: Partial<typeof tenants.$inferInsert>,
    updatedBy: UserId
  ): Promise<TenantRow> {
    const [row] = await this.db
      .update(tenants)
      .set({
        ...input,
        updatedAt: new Date(),
        updatedBy: updatedBy ?? input.updatedBy,
      })
      .where(eq(tenants.id, id))
      .returning();
    if (!row) throw new Error(`Tenant not found: ${id}`);
    return row;
  }

  async delete(id: TenantId, deletedBy: UserId): Promise<void> {
    await this.db
      .update(tenants)
      .set({
        deletedAt: new Date(),
        deletedBy,
        updatedAt: new Date(),
        updatedBy: deletedBy,
      })
      .where(eq(tenants.id, id));
  }

  async updateLastActivity(id: TenantId): Promise<void> {
    await this.db
      .update(tenants)
      .set({
        lastActivityAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, id));
  }
}

// ============================================================================
// UserRepository
// ============================================================================

type UserRow = typeof users.$inferSelect;

export interface UserFilters {
  status?: string;
  role?: string;
  search?: string;
}

export class UserRepository {
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
    row: UserRow | null,
    tenantId: TenantId | string,
  ): Promise<UserRow | null> {
    if (!row || !this.encPort) return row;
    return decryptRow({
      row,
      table: USERS_TABLE,
      tenantId: String(tenantId),
      port: this.encPort,
    });
  }

  private async decryptMany(
    rows: UserRow[],
    tenantId: TenantId | string,
  ): Promise<UserRow[]> {
    if (!this.encPort || rows.length === 0) return rows;
    return (await decryptRows(rows, {
      table: USERS_TABLE,
      tenantId: String(tenantId),
      port: this.encPort,
    })) as UserRow[];
  }

  async findById(id: string, tenantId: TenantId): Promise<UserRow | null> {
    const result = await this.db
      .select()
      .from(users)
      .where(
        and(
          eq(users.id, id),
          eq(users.tenantId, tenantId),
          isNull(users.deletedAt)
        )
      )
      .limit(1);
    return this.decryptOne(result[0] ?? null, tenantId);
  }

  /**
   * NOTE: `email` is encrypted-at-rest on users. See the parallel note on
   * CustomerRepository.findByEmail — direct WHERE-by-plaintext-email
   * will not find encrypted rows after back-fill. Pending lookup-hash
   * column migration; the call site is kept for back-compat with
   * pre-encryption flows.
   */
  async findByEmail(email: string, tenantId: TenantId): Promise<UserRow | null> {
    const result = await this.db
      .select()
      .from(users)
      .where(
        and(
          eq(users.email, email),
          eq(users.tenantId, tenantId),
          isNull(users.deletedAt)
        )
      )
      .limit(1);
    return this.decryptOne(result[0] ?? null, tenantId);
  }

  async findMany(
    tenantId: TenantId,
    limit = 50,
    offset = 0,
    filters?: UserFilters
  ) {
    const conditions = [
      eq(users.tenantId, tenantId),
      isNull(users.deletedAt),
    ];

    if (filters?.status) {
      // Bug fix A-BUG-DEEP #9: validate against the literal union so an
      // invalid status surfaces as ENUM_VALUE_INVALID rather than a
      // silently empty list.
      const status = assertUserStatus(filters.status);
      conditions.push(eq(users.status, status as unknown as typeof users.status.$inferType));
    }

    if (filters?.search) {
      const searchPattern = `%${filters.search}%`;
      conditions.push(
        or(
          like(users.firstName, searchPattern),
          like(users.lastName, searchPattern),
          like(users.email, searchPattern)
        )!
      );
    }

    const whereClause = and(...conditions);

    const rows = await this.db
      .select()
      .from(users)
      .where(whereClause)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(users)
      .where(whereClause);

    const decrypted = await this.decryptMany(rows, tenantId);
    return { items: decrypted, total, limit, offset, hasMore: offset + rows.length < total };
  }

  async create(data: typeof users.$inferInsert): Promise<UserRow> {
    const encryptedInput = this.encPort
      ? await encryptRow({
          row: { ...data },
          table: USERS_TABLE,
          tenantId: data.tenantId ? String(data.tenantId) : null,
          rowId: data.id ? String(data.id) : null,
          port: this.encPort,
          ...(this.encAudit ? { audit: this.encAudit } : {}),
        })
      : data;
    const [row] = await this.db.insert(users).values(encryptedInput).returning();
    if (!row) throw new Error('Failed to create user');
    return (await this.decryptOne(row, data.tenantId as TenantId)) as UserRow;
  }

  async update(
    id: string,
    tenantId: TenantId,
    data: Partial<typeof users.$inferInsert>
  ): Promise<UserRow | null> {
    const encryptedPatch = this.encPort
      ? await encryptRow({
          row: { ...data },
          table: USERS_TABLE,
          tenantId: String(tenantId),
          rowId: String(id),
          port: this.encPort,
          ...(this.encAudit ? { audit: this.encAudit } : {}),
        })
      : data;
    const [row] = await this.db
      .update(users)
      .set({ ...encryptedPatch, updatedAt: new Date() })
      .where(
        and(
          eq(users.id, id),
          eq(users.tenantId, tenantId),
          isNull(users.deletedAt)
        )
      )
      .returning();
    return this.decryptOne(row ?? null, tenantId);
  }

  async delete(id: string, tenantId: TenantId, deletedBy: string): Promise<void> {
    await this.db
      .update(users)
      .set({
        // Bug fix A-BUG-DEEP #9: 'deactivated' validated via the literal
        // union; the cast remains only to satisfy drizzle's pgEnum narrowing.
        status: assertUserStatus('deactivated') as unknown as typeof users.status.$inferType,
        deletedAt: new Date(),
        deletedBy,
        updatedAt: new Date(),
        updatedBy: deletedBy,
      })
      .where(
        and(
          eq(users.id, id),
          eq(users.tenantId, tenantId)
        )
      );
  }
}
