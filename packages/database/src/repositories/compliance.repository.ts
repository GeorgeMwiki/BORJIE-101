// @ts-nocheck — drizzle-orm v0.36 pgEnum column narrowing: accepts only literal union in eq(); repo params arrive as `string`. Tracked: drizzle-team/drizzle-orm#2389 (pgEnum string narrowing). Revisit after drizzle 0.37 lands widened overloads.
/**
 * Compliance & Document Repository
 * PostgreSQL implementation for Compliance Items, Legal Cases, Notices, and Document persistence
 */

import {
  eq,
  and,
  desc,
  asc,
  gte,
  lte,
  isNull,
  count,
} from 'drizzle-orm';
import type { DatabaseClient } from '../client.js';
import {
  complianceItems,
  legalCases,
  notices,
  documentUploads,
} from '../schemas/index.js';
import type { TenantId } from '@borjie/domain-models';
import { buildPaginatedResult } from './base.repository.js';
import { assertDocumentType, assertDocumentStatus } from './enum-guards.js';

export class ComplianceRepository {
  constructor(private db: DatabaseClient) {}

  // ============================================================================
  // Compliance Items
  // ============================================================================

  async createItem(data: typeof complianceItems.$inferInsert) {
    const [row] = await this.db.insert(complianceItems).values(data).returning();
    return row!;
  }

  async updateItem(
    id: string,
    tenantId: TenantId,
    data: Partial<typeof complianceItems.$inferInsert>
  ) {
    const [row] = await this.db
      .update(complianceItems)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(complianceItems.id, id),
          eq(complianceItems.tenantId, tenantId),
          isNull(complianceItems.deletedAt)
        )
      )
      .returning();
    return row ?? null;
  }

  async getItems(
    tenantId: TenantId,
    options?: {
      entityType?: string;
      entityId?: string;
      type?: string;
      status?: string;
      limit?: number;
      offset?: number;
    }
  ) {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const conditions = [
      eq(complianceItems.tenantId, tenantId),
      isNull(complianceItems.deletedAt),
    ];

    if (options?.entityType) {
      conditions.push(eq(complianceItems.entityType, options.entityType));
    }
    if (options?.entityId) {
      conditions.push(eq(complianceItems.entityId, options.entityId));
    }
    if (options?.type) {
      conditions.push(eq(complianceItems.type, options.type));
    }
    if (options?.status) {
      conditions.push(eq(complianceItems.status, options.status));
    }

    const rows = await this.db
      .select()
      .from(complianceItems)
      .where(and(...conditions))
      .orderBy(asc(complianceItems.dueDate))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(complianceItems)
      .where(and(...conditions));

    return buildPaginatedResult(rows, total, { limit, offset });
  }

  async getUpcoming(
    tenantId: TenantId,
    asOfDate: Date,
    daysAhead: number,
    limit = 50,
    offset = 0
  ) {
    // Bug fix A-BUG-DEEP #7: `Date.setDate(d.getDate() + n)` is
    // local-TZ-aware (it pivots around the host's clock) and mutates
    // the source Date. Compute the offset in pure UTC milliseconds so
    // the window is exactly `daysAhead * 86_400_000` regardless of the
    // server's timezone.
    const endDate = new Date(asOfDate.getTime() + daysAhead * 86_400_000);

    const rows = await this.db
      .select()
      .from(complianceItems)
      .where(
        and(
          eq(complianceItems.tenantId, tenantId),
          isNull(complianceItems.deletedAt),
          gte(complianceItems.dueDate, asOfDate),
          lte(complianceItems.dueDate, endDate),
          eq(complianceItems.status, 'pending')
        )
      )
      .orderBy(asc(complianceItems.dueDate))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(complianceItems)
      .where(
        and(
          eq(complianceItems.tenantId, tenantId),
          isNull(complianceItems.deletedAt),
          gte(complianceItems.dueDate, asOfDate),
          lte(complianceItems.dueDate, endDate),
          eq(complianceItems.status, 'pending')
        )
      );

    return buildPaginatedResult(rows, total, { limit, offset });
  }

  async getOverdue(tenantId: TenantId, asOfDate: Date, limit = 50, offset = 0) {
    const rows = await this.db
      .select()
      .from(complianceItems)
      .where(
        and(
          eq(complianceItems.tenantId, tenantId),
          isNull(complianceItems.deletedAt),
          lte(complianceItems.dueDate, asOfDate),
          eq(complianceItems.status, 'pending')
        )
      )
      .orderBy(asc(complianceItems.dueDate))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(complianceItems)
      .where(
        and(
          eq(complianceItems.tenantId, tenantId),
          isNull(complianceItems.deletedAt),
          lte(complianceItems.dueDate, asOfDate),
          eq(complianceItems.status, 'pending')
        )
      );

    return buildPaginatedResult(rows, total, { limit, offset });
  }

  // ============================================================================
  // Legal Cases
  // ============================================================================

  async createCase(data: typeof legalCases.$inferInsert) {
    const [row] = await this.db.insert(legalCases).values(data).returning();
    return row!;
  }

  async updateCase(
    id: string,
    tenantId: TenantId,
    data: Partial<typeof legalCases.$inferInsert>
  ) {
    const [row] = await this.db
      .update(legalCases)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(legalCases.id, id),
          eq(legalCases.tenantId, tenantId),
          isNull(legalCases.deletedAt)
        )
      )
      .returning();
    return row ?? null;
  }

  async getCases(
    tenantId: TenantId,
    options?: {
      status?: string;
      propertyId?: string;
      customerId?: string;
      limit?: number;
      offset?: number;
    }
  ) {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const conditions = [
      eq(legalCases.tenantId, tenantId),
      isNull(legalCases.deletedAt),
    ];

    if (options?.status) {
      conditions.push(eq(legalCases.status, options.status));
    }
    if (options?.propertyId) {
      conditions.push(eq(legalCases.propertyId, options.propertyId));
    }
    if (options?.customerId) {
      conditions.push(eq(legalCases.customerId, options.customerId));
    }

    const rows = await this.db
      .select()
      .from(legalCases)
      .where(and(...conditions))
      .orderBy(desc(legalCases.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(legalCases)
      .where(and(...conditions));

    return buildPaginatedResult(rows, total, { limit, offset });
  }

  // ============================================================================
  // Notices
  // ============================================================================

  async createNotice(data: typeof notices.$inferInsert) {
    const [row] = await this.db.insert(notices).values(data).returning();
    return row!;
  }

  async getNotices(
    tenantId: TenantId,
    options?: {
      type?: string;
      customerId?: string;
      propertyId?: string;
      limit?: number;
      offset?: number;
    }
  ) {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const conditions = [
      eq(notices.tenantId, tenantId),
      isNull(notices.deletedAt),
    ];

    if (options?.type) {
      conditions.push(eq(notices.type, options.type));
    }
    if (options?.customerId) {
      conditions.push(eq(notices.customerId, options.customerId));
    }
    if (options?.propertyId) {
      conditions.push(eq(notices.propertyId, options.propertyId));
    }

    const rows = await this.db
      .select()
      .from(notices)
      .where(and(...conditions))
      .orderBy(desc(notices.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(notices)
      .where(and(...conditions));

    return buildPaginatedResult(rows, total, { limit, offset });
  }
}

// ============================================================================
// DocumentRepository
// ============================================================================

export class DocumentRepository {
  constructor(private db: DatabaseClient) {}

  async findById(id: string, tenantId: TenantId) {
    const rows = await this.db
      .select()
      .from(documentUploads)
      .where(
        and(
          eq(documentUploads.id, id),
          eq(documentUploads.tenantId, tenantId),
          isNull(documentUploads.deletedAt)
        )
      );
    return rows[0] ?? null;
  }

  async findMany(
    tenantId: TenantId,
    options?: {
      documentType?: string;
      status?: string;
      entityType?: string;
      entityId?: string;
      customerId?: string;
      limit?: number;
      offset?: number;
    }
  ) {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const conditions = [
      eq(documentUploads.tenantId, tenantId),
      isNull(documentUploads.deletedAt),
    ];

    if (options?.documentType) {
      // Bug fix A-BUG-DEEP #9: validate inputs against the literal union so
      // an invalid documentType / status surfaces as ENUM_VALUE_INVALID
      // instead of producing a silently-empty page.
      const docType = assertDocumentType(options.documentType);
      conditions.push(eq(documentUploads.documentType, docType as unknown as typeof documentUploads.documentType.$inferType));
    }
    if (options?.status) {
      const status = assertDocumentStatus(options.status);
      conditions.push(eq(documentUploads.status, status as unknown as typeof documentUploads.status.$inferType));
    }
    if (options?.entityType) {
      conditions.push(eq(documentUploads.entityType, options.entityType));
    }
    if (options?.entityId) {
      conditions.push(eq(documentUploads.entityId, options.entityId));
    }
    if (options?.customerId) {
      conditions.push(eq(documentUploads.customerId, options.customerId));
    }

    const rows = await this.db
      .select()
      .from(documentUploads)
      .where(and(...conditions))
      .orderBy(desc(documentUploads.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(documentUploads)
      .where(and(...conditions));

    return buildPaginatedResult(rows, total, { limit, offset });
  }

  async create(data: typeof documentUploads.$inferInsert) {
    const [row] = await this.db.insert(documentUploads).values(data).returning();
    return row!;
  }

  async update(
    id: string,
    tenantId: TenantId,
    data: Partial<typeof documentUploads.$inferInsert>
  ) {
    const [row] = await this.db
      .update(documentUploads)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(documentUploads.id, id),
          eq(documentUploads.tenantId, tenantId),
          isNull(documentUploads.deletedAt)
        )
      )
      .returning();
    return row ?? null;
  }

  async delete(id: string, tenantId: TenantId, deletedBy: string) {
    await this.db
      .update(documentUploads)
      .set({ deletedAt: new Date(), deletedBy })
      .where(
        and(
          eq(documentUploads.id, id),
          eq(documentUploads.tenantId, tenantId)
        )
      );
  }
}
