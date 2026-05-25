// @ts-nocheck — drizzle-orm v0.36 pgEnum narrowing rejects string assignments on utilityType/status columns; revisit when schema enums tighten. Tracked: drizzle-team/drizzle-orm#2389.
/**
 * Utilities Repository
 * PostgreSQL implementation for Utility Accounts, Readings, and Bills persistence
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
  utilityAccounts,
  utilityReadings,
  utilityBills,
} from '../schemas/index.js';
import type { TenantId } from '@borjie/domain-models';
import { buildPaginatedResult } from './base.repository.js';

export class UtilitiesRepository {
  constructor(private db: DatabaseClient) {}

  async createAccount(data: typeof utilityAccounts.$inferInsert) {
    const [row] = await this.db.insert(utilityAccounts).values(data).returning();
    return row!;
  }

  async getAccount(id: string, tenantId: TenantId) {
    const rows = await this.db
      .select()
      .from(utilityAccounts)
      .where(
        and(
          eq(utilityAccounts.id, id),
          eq(utilityAccounts.tenantId, tenantId),
          isNull(utilityAccounts.deletedAt)
        )
      );
    return rows[0] ?? null;
  }

  async getAccounts(
    tenantId: TenantId,
    options?: {
      propertyId?: string;
      unitId?: string;
      utilityType?: string;
      limit?: number;
      offset?: number;
    }
  ) {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const conditions = [
      eq(utilityAccounts.tenantId, tenantId),
      isNull(utilityAccounts.deletedAt),
    ];

    if (options?.propertyId) {
      conditions.push(eq(utilityAccounts.propertyId, options.propertyId));
    }
    if (options?.unitId) {
      conditions.push(eq(utilityAccounts.unitId, options.unitId));
    }
    if (options?.utilityType) {
      conditions.push(eq(utilityAccounts.utilityType, options.utilityType));
    }

    const rows = await this.db
      .select()
      .from(utilityAccounts)
      .where(and(...conditions))
      .orderBy(desc(utilityAccounts.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(utilityAccounts)
      .where(and(...conditions));

    return buildPaginatedResult(rows, total, { limit, offset });
  }

  async createReading(data: typeof utilityReadings.$inferInsert) {
    const [row] = await this.db.insert(utilityReadings).values(data).returning();
    return row!;
  }

  async getReadings(
    accountId: string,
    options?: { limit?: number; offset?: number; startDate?: Date; endDate?: Date }
  ) {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const conditions = [eq(utilityReadings.accountId, accountId)];

    if (options?.startDate) {
      conditions.push(gte(utilityReadings.readingDate, options.startDate));
    }
    if (options?.endDate) {
      conditions.push(lte(utilityReadings.readingDate, options.endDate));
    }

    return this.db
      .select()
      .from(utilityReadings)
      .where(and(...conditions))
      .orderBy(desc(utilityReadings.readingDate))
      .limit(limit)
      .offset(offset);
  }

  async createBill(data: typeof utilityBills.$inferInsert) {
    const [row] = await this.db.insert(utilityBills).values(data).returning();
    return row!;
  }

  async getBills(
    accountId: string,
    options?: { status?: string; limit?: number; offset?: number }
  ) {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const conditions = [eq(utilityBills.accountId, accountId)];

    if (options?.status) {
      conditions.push(eq(utilityBills.status, options.status));
    }

    return this.db
      .select()
      .from(utilityBills)
      .where(and(...conditions))
      .orderBy(desc(utilityBills.periodEnd))
      .limit(limit)
      .offset(offset);
  }

  async updateBillStatus(
    id: string,
    accountId: string,
    status: string,
    paidAt?: Date
  ) {
    const [row] = await this.db
      .update(utilityBills)
      .set({
        status,
        paidAt: status === 'paid' ? paidAt ?? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(utilityBills.id, id), eq(utilityBills.accountId, accountId)))
      .returning();
    return row ?? null;
  }

  async getConsumptionHistory(
    accountId: string,
    startDate: Date,
    endDate: Date,
    limit = 100
  ) {
    return this.db
      .select()
      .from(utilityReadings)
      .where(
        and(
          eq(utilityReadings.accountId, accountId),
          gte(utilityReadings.readingDate, startDate),
          lte(utilityReadings.readingDate, endDate)
        )
      )
      .orderBy(asc(utilityReadings.readingDate))
      .limit(limit);
  }
}
