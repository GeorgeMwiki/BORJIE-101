// @ts-nocheck — drizzle-orm v0.36 update-shape narrowing; downstream apps use exactOptionalPropertyTypes
/**
 * Scheduling Repository
 * PostgreSQL implementation for Scheduled Events and Availability persistence
 */

import {
  eq,
  ne,
  and,
  or,
  asc,
  desc,
  gte,
  lte,
  isNull,
  count,
} from 'drizzle-orm';
import type { DatabaseClient } from '../client.js';
import {
  scheduledEvents,
  availability,
  availabilitySlots,
} from '../schemas/index.js';
import type { TenantId } from '@borjie/domain-models';
import { buildPaginatedResult } from './base.repository.js';

export class SchedulingRepository {
  constructor(private db: DatabaseClient) {}

  async createEvent(data: typeof scheduledEvents.$inferInsert) {
    const [row] = await this.db.insert(scheduledEvents).values(data).returning();
    return row!;
  }

  async updateEvent(
    id: string,
    tenantId: TenantId,
    data: Partial<typeof scheduledEvents.$inferInsert>
  ) {
    const [row] = await this.db
      .update(scheduledEvents)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(scheduledEvents.id, id),
          eq(scheduledEvents.tenantId, tenantId),
          isNull(scheduledEvents.cancelledAt)
        )
      )
      .returning();
    return row ?? null;
  }

  async deleteEvent(id: string, tenantId: TenantId, cancelledBy?: string) {
    const [row] = await this.db
      .update(scheduledEvents)
      .set({
        cancelledAt: new Date(),
        cancelledBy: cancelledBy ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(scheduledEvents.id, id),
          eq(scheduledEvents.tenantId, tenantId)
        )
      )
      .returning();
    return row ?? null;
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
      .from(scheduledEvents)
      .where(
        and(
          eq(scheduledEvents.tenantId, tenantId),
          isNull(scheduledEvents.cancelledAt),
          gte(scheduledEvents.endAt, startDate),
          lte(scheduledEvents.startAt, endDate)
        )
      )
      .orderBy(asc(scheduledEvents.startAt))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(scheduledEvents)
      .where(
        and(
          eq(scheduledEvents.tenantId, tenantId),
          isNull(scheduledEvents.cancelledAt),
          gte(scheduledEvents.endAt, startDate),
          lte(scheduledEvents.startAt, endDate)
        )
      );
    return buildPaginatedResult(rows, total, { limit, offset });
  }

  async findByProperty(
    propertyId: string,
    tenantId: TenantId,
    limit = 50,
    offset = 0
  ) {
    const rows = await this.db
      .select()
      .from(scheduledEvents)
      .where(
        and(
          eq(scheduledEvents.propertyId, propertyId),
          eq(scheduledEvents.tenantId, tenantId),
          isNull(scheduledEvents.cancelledAt)
        )
      )
      .orderBy(desc(scheduledEvents.startAt))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(scheduledEvents)
      .where(
        and(
          eq(scheduledEvents.propertyId, propertyId),
          eq(scheduledEvents.tenantId, tenantId),
          isNull(scheduledEvents.cancelledAt)
        )
      );
    return buildPaginatedResult(rows, total, { limit, offset });
  }

  async findByUser(
    userId: string,
    tenantId: TenantId,
    options?: { startDate?: Date; endDate?: Date; limit?: number; offset?: number }
  ) {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const conditions = [
      eq(scheduledEvents.assignedTo, userId),
      eq(scheduledEvents.tenantId, tenantId),
      isNull(scheduledEvents.cancelledAt),
    ];

    if (options?.startDate) {
      conditions.push(gte(scheduledEvents.endAt, options.startDate));
    }
    if (options?.endDate) {
      conditions.push(lte(scheduledEvents.startAt, options.endDate));
    }

    const rows = await this.db
      .select()
      .from(scheduledEvents)
      .where(and(...conditions))
      .orderBy(desc(scheduledEvents.startAt))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(scheduledEvents)
      .where(and(...conditions));
    return buildPaginatedResult(rows, total, { limit, offset });
  }

  async createAvailability(data: typeof availability.$inferInsert) {
    const [row] = await this.db.insert(availability).values(data).returning();
    return row!;
  }

  async getAvailability(
    tenantId: TenantId,
    options?: { resourceType?: string; resourceId?: string }
  ) {
    const conditions = [eq(availability.tenantId, tenantId)];

    if (options?.resourceType) {
      conditions.push(eq(availability.resourceType, options.resourceType));
    }
    if (options?.resourceId) {
      conditions.push(eq(availability.resourceId, options.resourceId));
    }

    return this.db
      .select()
      .from(availability)
      .where(and(...conditions))
      .orderBy(availability.dayOfWeek);
  }

  async createAvailabilitySlot(data: typeof availabilitySlots.$inferInsert) {
    const [row] = await this.db.insert(availabilitySlots).values(data).returning();
    return row!;
  }

  async findConflicts(
    tenantId: TenantId,
    startAt: Date,
    endAt: Date,
    options?: { excludeEventId?: string; propertyId?: string; assignedTo?: string }
  ) {
    const conditions = [
      eq(scheduledEvents.tenantId, tenantId),
      isNull(scheduledEvents.cancelledAt),
      or(
        and(
          gte(scheduledEvents.startAt, startAt),
          lte(scheduledEvents.startAt, endAt)
        ),
        and(
          gte(scheduledEvents.endAt, startAt),
          lte(scheduledEvents.endAt, endAt)
        ),
        and(
          lte(scheduledEvents.startAt, startAt),
          gte(scheduledEvents.endAt, endAt)
        )
      ),
    ];

    if (options?.excludeEventId) {
      conditions.push(ne(scheduledEvents.id, options.excludeEventId));
    }
    if (options?.propertyId) {
      conditions.push(eq(scheduledEvents.propertyId, options.propertyId));
    }
    if (options?.assignedTo) {
      conditions.push(eq(scheduledEvents.assignedTo, options.assignedTo));
    }

    return this.db
      .select()
      .from(scheduledEvents)
      .where(and(...conditions))
      .orderBy(asc(scheduledEvents.startAt));
  }
}