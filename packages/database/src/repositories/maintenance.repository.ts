// @ts-nocheck — drizzle-orm v0.36 pgEnum column narrowing: accepts only literal union in eq(); repo params arrive as `string`. Tracked: drizzle-team/drizzle-orm#2389 (pgEnum string narrowing). Revisit after drizzle 0.37 lands widened overloads.
/**
 * Maintenance Repository Implementations
 * PostgreSQL implementations for WorkOrder and Vendor persistence
 */

import {
  eq,
  and,
  desc,
  sql,
  isNull,
  or,
  count,
  inArray,
} from 'drizzle-orm';
import type { DatabaseClient } from '../client.js';
import { workOrders, vendors } from '../schemas/index.js';
import type { TenantId } from '@borjie/domain-models';

// ============================================================================
// WorkOrderRepository
// ============================================================================

export class WorkOrderRepository {
  constructor(private db: DatabaseClient) {}

  async findMany(tenantId: TenantId, limit = 50, offset = 0) {
    const rows = await this.db
      .select()
      .from(workOrders)
      .where(
        and(
          eq(workOrders.tenantId, tenantId),
          isNull(workOrders.deletedAt)
        )
      )
      .orderBy(desc(workOrders.createdAt))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(workOrders)
      .where(
        and(
          eq(workOrders.tenantId, tenantId),
          isNull(workOrders.deletedAt)
        )
      );
    return { items: rows, total, limit, offset, hasMore: offset + rows.length < total };
  }

  async findById(id: string, tenantId: TenantId) {
    const rows = await this.db
      .select()
      .from(workOrders)
      .where(
        and(
          eq(workOrders.id, id),
          eq(workOrders.tenantId, tenantId),
          isNull(workOrders.deletedAt)
        )
      );
    return rows[0] ?? null;
  }

  async findByNumber(workOrderNumber: string, tenantId: TenantId) {
    const rows = await this.db
      .select()
      .from(workOrders)
      .where(
        and(
          eq(workOrders.workOrderNumber, workOrderNumber),
          eq(workOrders.tenantId, tenantId),
          isNull(workOrders.deletedAt)
        )
      );
    return rows[0] ?? null;
  }

  async findByProperty(propertyId: string, tenantId: TenantId, limit = 50, offset = 0) {
    const rows = await this.db
      .select()
      .from(workOrders)
      .where(
        and(
          eq(workOrders.propertyId, propertyId),
          eq(workOrders.tenantId, tenantId),
          isNull(workOrders.deletedAt)
        )
      )
      .orderBy(desc(workOrders.createdAt))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(workOrders)
      .where(
        and(
          eq(workOrders.propertyId, propertyId),
          eq(workOrders.tenantId, tenantId),
          isNull(workOrders.deletedAt)
        )
      );
    return { items: rows, total, limit, offset, hasMore: offset + rows.length < total };
  }

  async findByUnit(unitId: string, tenantId: TenantId, limit = 50, offset = 0) {
    const rows = await this.db
      .select()
      .from(workOrders)
      .where(
        and(
          eq(workOrders.unitId, unitId),
          eq(workOrders.tenantId, tenantId),
          isNull(workOrders.deletedAt)
        )
      )
      .orderBy(desc(workOrders.createdAt))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(workOrders)
      .where(
        and(
          eq(workOrders.unitId, unitId),
          eq(workOrders.tenantId, tenantId),
          isNull(workOrders.deletedAt)
        )
      );
    return { items: rows, total, limit, offset, hasMore: offset + rows.length < total };
  }

  async findByCustomer(customerId: string, tenantId: TenantId, limit = 50, offset = 0) {
    const rows = await this.db
      .select()
      .from(workOrders)
      .where(
        and(
          eq(workOrders.customerId, customerId),
          eq(workOrders.tenantId, tenantId),
          isNull(workOrders.deletedAt)
        )
      )
      .orderBy(desc(workOrders.createdAt))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(workOrders)
      .where(
        and(
          eq(workOrders.customerId, customerId),
          eq(workOrders.tenantId, tenantId),
          isNull(workOrders.deletedAt)
        )
      );
    return { items: rows, total, limit, offset, hasMore: offset + rows.length < total };
  }

  async findByVendor(vendorId: string, tenantId: TenantId, limit = 50, offset = 0) {
    const rows = await this.db
      .select()
      .from(workOrders)
      .where(
        and(
          eq(workOrders.vendorId, vendorId),
          eq(workOrders.tenantId, tenantId),
          isNull(workOrders.deletedAt)
        )
      )
      .orderBy(desc(workOrders.createdAt))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(workOrders)
      .where(
        and(
          eq(workOrders.vendorId, vendorId),
          eq(workOrders.tenantId, tenantId),
          isNull(workOrders.deletedAt)
        )
      );
    return { items: rows, total, limit, offset, hasMore: offset + rows.length < total };
  }

  async findByStatus(status: string, tenantId: TenantId, limit = 50, offset = 0) {
    const rows = await this.db
      .select()
      .from(workOrders)
      .where(
        and(
          eq(workOrders.status, status),
          eq(workOrders.tenantId, tenantId),
          isNull(workOrders.deletedAt)
        )
      )
      .orderBy(desc(workOrders.createdAt))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(workOrders)
      .where(
        and(
          eq(workOrders.status, status),
          eq(workOrders.tenantId, tenantId),
          isNull(workOrders.deletedAt)
        )
      );
    return { items: rows, total, limit, offset, hasMore: offset + rows.length < total };
  }

  async findByPriority(priority: string, tenantId: TenantId, limit = 50, offset = 0) {
    const rows = await this.db
      .select()
      .from(workOrders)
      .where(
        and(
          eq(workOrders.priority, priority),
          eq(workOrders.tenantId, tenantId),
          isNull(workOrders.deletedAt)
        )
      )
      .orderBy(desc(workOrders.createdAt))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(workOrders)
      .where(
        and(
          eq(workOrders.priority, priority),
          eq(workOrders.tenantId, tenantId),
          isNull(workOrders.deletedAt)
        )
      );
    return { items: rows, total, limit, offset, hasMore: offset + rows.length < total };
  }

  async findSLABreached(tenantId: TenantId) {
    return this.db
      .select()
      .from(workOrders)
      .where(
        and(
          eq(workOrders.tenantId, tenantId),
          isNull(workOrders.deletedAt),
          or(
            eq(workOrders.responseBreached, true),
            eq(workOrders.resolutionBreached, true)
          )
        )
      )
      .orderBy(desc(workOrders.createdAt));
  }

  async create(data: typeof workOrders.$inferInsert) {
    const [row] = await this.db.insert(workOrders).values(data).returning();
    return row!;
  }

  async update(id: string, tenantId: TenantId, data: Partial<typeof workOrders.$inferInsert>) {
    const [row] = await this.db
      .update(workOrders)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(workOrders.id, id),
          eq(workOrders.tenantId, tenantId),
          isNull(workOrders.deletedAt)
        )
      )
      .returning();
    return row ?? null;
  }

  async delete(id: string, tenantId: TenantId, deletedBy: string) {
    await this.db
      .update(workOrders)
      .set({ deletedAt: new Date(), deletedBy })
      .where(and(eq(workOrders.id, id), eq(workOrders.tenantId, tenantId)));
  }

  async getNextSequence(tenantId: TenantId): Promise<number> {
    const [{ count: c }] = await this.db
      .select({ count: count() })
      .from(workOrders)
      .where(eq(workOrders.tenantId, tenantId));
    return (c ?? 0) + 1;
  }

  async countByStatus(tenantId: TenantId): Promise<Record<string, number>> {
    const rows = await this.db
      .select({
        status: workOrders.status,
        count: count(),
      })
      .from(workOrders)
      .where(
        and(eq(workOrders.tenantId, tenantId), isNull(workOrders.deletedAt))
      )
      .groupBy(workOrders.status);
    return Object.fromEntries(rows.map((r) => [r.status, r.count]));
  }
}

// ============================================================================
// VendorRepository
// ============================================================================

export class VendorRepository {
  constructor(private db: DatabaseClient) {}

  async findMany(
    tenantId: TenantId,
    limit = 50,
    offset = 0,
    filters: {
      readonly status?: string;
      readonly specialization?: string;
    } = {}
  ) {
    const predicates = [
      eq(vendors.tenantId, tenantId),
      isNull(vendors.deletedAt),
    ];
    if (filters.status) {
      predicates.push(eq(vendors.status, filters.status));
    }
    if (filters.specialization) {
      predicates.push(
        sql`${vendors.specializations} @> ${JSON.stringify([filters.specialization])}::jsonb`
      );
    }
    const whereClause = and(...predicates);
    const rows = await this.db
      .select()
      .from(vendors)
      .where(whereClause)
      .orderBy(desc(vendors.createdAt))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(vendors)
      .where(whereClause);
    return { items: rows, total, limit, offset, hasMore: offset + rows.length < total };
  }

  async findById(id: string, tenantId: TenantId) {
    const rows = await this.db
      .select()
      .from(vendors)
      .where(
        and(
          eq(vendors.id, id),
          eq(vendors.tenantId, tenantId),
          isNull(vendors.deletedAt)
        )
      );
    return rows[0] ?? null;
  }

  /**
   * Wave 25 Agent V: batch fetch many vendors by id (IN-query) — replaces
   * per-row `findById` fan-out in owner-portal BFF.
   */
  async findByIds(ids: string[], tenantId: TenantId) {
    if (ids.length === 0) return [];
    const unique = Array.from(new Set(ids));
    return this.db
      .select()
      .from(vendors)
      .where(
        and(
          inArray(vendors.id, unique),
          eq(vendors.tenantId, tenantId),
          isNull(vendors.deletedAt)
        )
      );
  }

  async findByCode(vendorCode: string, tenantId: TenantId) {
    const rows = await this.db
      .select()
      .from(vendors)
      .where(
        and(
          eq(vendors.vendorCode, vendorCode),
          eq(vendors.tenantId, tenantId),
          isNull(vendors.deletedAt)
        )
      );
    return rows[0] ?? null;
  }

  async findBySpecialization(specialization: string, tenantId: TenantId) {
    return this.db
      .select()
      .from(vendors)
      .where(
        and(
          eq(vendors.tenantId, tenantId),
          isNull(vendors.deletedAt),
          sql`${vendors.specializations} @> ${JSON.stringify([specialization])}::jsonb`
        )
      )
      .orderBy(desc(vendors.createdAt));
  }

  async findAvailable(
    specialization: string,
    emergency: boolean,
    tenantId: TenantId
  ) {
    const conditions = [
      eq(vendors.tenantId, tenantId),
      eq(vendors.status, 'active'),
      isNull(vendors.deletedAt),
      sql`${vendors.specializations} @> ${JSON.stringify([specialization])}::jsonb`,
    ];
    if (emergency) {
      conditions.push(eq(vendors.emergencyAvailable, true));
    }
    return this.db
      .select()
      .from(vendors)
      .where(and(...conditions))
      .orderBy(desc(vendors.isPreferred));
  }

  async findPreferred(tenantId: TenantId) {
    return this.db
      .select()
      .from(vendors)
      .where(
        and(
          eq(vendors.tenantId, tenantId),
          eq(vendors.isPreferred, true),
          eq(vendors.status, 'active'),
          isNull(vendors.deletedAt)
        )
      )
      .orderBy(desc(vendors.createdAt));
  }

  async create(data: typeof vendors.$inferInsert) {
    const [row] = await this.db.insert(vendors).values(data).returning();
    return row!;
  }

  async update(id: string, tenantId: TenantId, data: Partial<typeof vendors.$inferInsert>) {
    const [row] = await this.db
      .update(vendors)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(vendors.id, id),
          eq(vendors.tenantId, tenantId),
          isNull(vendors.deletedAt)
        )
      )
      .returning();
    return row ?? null;
  }

  async delete(id: string, tenantId: TenantId, deletedBy: string) {
    await this.db
      .update(vendors)
      .set({ deletedAt: new Date(), deletedBy })
      .where(and(eq(vendors.id, id), eq(vendors.tenantId, tenantId)));
  }

  async getNextSequence(tenantId: TenantId): Promise<number> {
    const [{ count: c }] = await this.db
      .select({ count: count() })
      .from(vendors)
      .where(eq(vendors.tenantId, tenantId));
    return (c ?? 0) + 1;
  }
}
