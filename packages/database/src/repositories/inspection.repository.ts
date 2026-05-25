// @ts-nocheck — drizzle-orm v0.36 pgEnum column narrowing: accepts only literal union in eq(); repo params arrive as `string`. Tracked: drizzle-team/drizzle-orm#2389 (pgEnum string narrowing). Revisit after drizzle 0.37 lands widened overloads.
/**
 * Inspection Repository
 * PostgreSQL implementation for Inspection persistence
 */

import {
  eq,
  and,
  asc,
  desc,
  gte,
  lte,
  isNull,
  count,
} from 'drizzle-orm';
import type { DatabaseClient } from '../client.js';
import {
  inspections,
  inspectionItems,
  inspectionSignatures,
} from '../schemas/index.js';
import type { TenantId } from '@borjie/domain-models';
import { buildPaginatedResult } from './base.repository.js';

export class InspectionRepository {
  constructor(private db: DatabaseClient) {}

  async create(data: typeof inspections.$inferInsert) {
    const [row] = await this.db.insert(inspections).values(data).returning();
    return row!;
  }

  async update(
    id: string,
    tenantId: TenantId,
    data: Partial<typeof inspections.$inferInsert>
  ) {
    const [row] = await this.db
      .update(inspections)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(inspections.id, id),
          eq(inspections.tenantId, tenantId),
          isNull(inspections.deletedAt)
        )
      )
      .returning();
    return row ?? null;
  }

  async findById(id: string, tenantId: TenantId) {
    const rows = await this.db
      .select()
      .from(inspections)
      .where(
        and(
          eq(inspections.id, id),
          eq(inspections.tenantId, tenantId),
          isNull(inspections.deletedAt)
        )
      );
    return rows[0] ?? null;
  }

  async findByProperty(propertyId: string, tenantId: TenantId, limit = 50, offset = 0) {
    const rows = await this.db
      .select()
      .from(inspections)
      .where(
        and(
          eq(inspections.propertyId, propertyId),
          eq(inspections.tenantId, tenantId),
          isNull(inspections.deletedAt)
        )
      )
      .orderBy(desc(inspections.scheduledDate))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(inspections)
      .where(
        and(
          eq(inspections.propertyId, propertyId),
          eq(inspections.tenantId, tenantId),
          isNull(inspections.deletedAt)
        )
      );
    return buildPaginatedResult(rows, total, { limit, offset });
  }

  async findByDateRange(
    startDate: Date,
    endDate: Date,
    tenantId: TenantId,
    limit = 50,
    offset = 0
  ) {
    const rows = await this.db
      .select()
      .from(inspections)
      .where(
        and(
          eq(inspections.tenantId, tenantId),
          isNull(inspections.deletedAt),
          gte(inspections.scheduledDate, startDate),
          lte(inspections.scheduledDate, endDate)
        )
      )
      .orderBy(desc(inspections.scheduledDate))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(inspections)
      .where(
        and(
          eq(inspections.tenantId, tenantId),
          isNull(inspections.deletedAt),
          gte(inspections.scheduledDate, startDate),
          lte(inspections.scheduledDate, endDate)
        )
      );
    return buildPaginatedResult(rows, total, { limit, offset });
  }

  async findByStatus(status: string, tenantId: TenantId, limit = 50, offset = 0) {
    const rows = await this.db
      .select()
      .from(inspections)
      .where(
        and(
          eq(inspections.status, status),
          eq(inspections.tenantId, tenantId),
          isNull(inspections.deletedAt)
        )
      )
      .orderBy(desc(inspections.scheduledDate))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(inspections)
      .where(
        and(
          eq(inspections.status, status),
          eq(inspections.tenantId, tenantId),
          isNull(inspections.deletedAt)
        )
      );
    return buildPaginatedResult(rows, total, { limit, offset });
  }

  async addItem(data: typeof inspectionItems.$inferInsert) {
    const [row] = await this.db.insert(inspectionItems).values(data).returning();
    return row!;
  }

  async updateItem(
    id: string,
    inspectionId: string,
    data: Partial<typeof inspectionItems.$inferInsert>
  ) {
    const [row] = await this.db
      .update(inspectionItems)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(inspectionItems.id, id),
          eq(inspectionItems.inspectionId, inspectionId)
        )
      )
      .returning();
    return row ?? null;
  }

  async getItems(inspectionId: string) {
    return this.db
      .select()
      .from(inspectionItems)
      .where(eq(inspectionItems.inspectionId, inspectionId))
      .orderBy(asc(inspectionItems.room), asc(inspectionItems.item));
  }

  async addSignature(data: typeof inspectionSignatures.$inferInsert) {
    const [row] = await this.db.insert(inspectionSignatures).values(data).returning();
    return row!;
  }

  async getSignatures(inspectionId: string) {
    return this.db
      .select()
      .from(inspectionSignatures)
      .where(eq(inspectionSignatures.inspectionId, inspectionId));
  }
}
