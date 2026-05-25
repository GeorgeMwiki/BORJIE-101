// @ts-nocheck — domain-models drift (WorkOrder/Block namespace shape, Money class, TenantStatus enum); tracked
/**
 * In-memory repository implementations for Scheduling.
 * Use for testing, development, or as a reference for persistence implementations.
 */

import type {
  TenantId,
  UserId,
  ISOTimestamp,
  PaginationParams,
  PaginatedResult,
} from '@borjie/domain-models';
import type {
  ScheduleEvent,
  ScheduleEventId,
  ScheduleEventFilters,
  WorkingHours,
  Availability,
} from './types.js';
import type {
  SchedulingRepository,
  WorkingHoursRepository,
  AvailabilityRepository,
} from './scheduling-repository.interface.js';

// ============================================================================
// Scheduling Repository
// ============================================================================

export class InMemorySchedulingRepository implements SchedulingRepository {
  private events = new Map<string, ScheduleEvent>();

  private key(id: ScheduleEventId, tenantId: TenantId): string {
    return `${tenantId}:${id}`;
  }

  async findById(id: ScheduleEventId, tenantId: TenantId): Promise<ScheduleEvent | null> {
    return this.events.get(this.key(id, tenantId)) ?? null;
  }

  async create(event: ScheduleEvent): Promise<ScheduleEvent> {
    this.events.set(this.key(event.id, event.tenantId), event);
    return event;
  }

  async update(event: ScheduleEvent): Promise<ScheduleEvent> {
    this.events.set(this.key(event.id, event.tenantId), event);
    return event;
  }

  async list(
    tenantId: TenantId,
    filters: ScheduleEventFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<ScheduleEvent>> {
    let items = [...this.events.values()].filter((e) => e.tenantId === tenantId);

    if (filters.type) {
      const types = Array.isArray(filters.type) ? filters.type : [filters.type];
      items = items.filter((e) => types.includes(e.type));
    }
    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      items = items.filter((e) => statuses.includes(e.status));
    }
    if (filters.propertyId) {
      items = items.filter((e) => e.propertyId === filters.propertyId);
    }
    if (filters.unitId) {
      items = items.filter((e) => e.unitId === filters.unitId);
    }
    if (filters.customerId) {
      items = items.filter((e) => e.customerId === filters.customerId);
    }
    if (filters.userId) {
      items = items.filter((e) =>
        e.attendees.some((a) => a.userId === filters.userId)
      );
    }
    if (filters.startFrom) {
      items = items.filter((e) => e.startAt >= filters.startFrom!);
    }
    if (filters.startTo) {
      items = items.filter((e) => e.startAt <= filters.startTo!);
    }

    items.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

    const total = items.length;
    const limit = pagination?.limit ?? 50;
    const offset = pagination?.offset ?? 0;
    const paginatedItems = items.slice(offset, offset + limit);

    return {
      items: paginatedItems,
      total,
      limit,
      offset,
      hasMore: offset + paginatedItems.length < total,
    };
  }

  async findByUserId(
    userId: UserId,
    tenantId: TenantId,
    fromDate: ISOTimestamp,
    toDate: ISOTimestamp
  ): Promise<readonly ScheduleEvent[]> {
    const from = new Date(fromDate).getTime();
    const to = new Date(toDate).getTime();

    return [...this.events.values()].filter((e) => {
      if (e.tenantId !== tenantId) return false;
      if (e.status === 'cancelled') return false;
      const eventStart = new Date(e.startAt).getTime();
      const eventEnd = new Date(e.endAt).getTime();
      if (eventEnd < from || eventStart > to) return false;
      const isParticipant =
        e.createdBy === userId ||
        e.attendees.some((a) => a.userId === userId || a.customerId === userId);
      return isParticipant;
    });
  }

  async findConflicting(
    tenantId: TenantId,
    participantIds: readonly string[],
    startAt: ISOTimestamp,
    endAt: ISOTimestamp,
    excludeEventId?: ScheduleEventId
  ): Promise<readonly ScheduleEvent[]> {
    const start = new Date(startAt).getTime();
    const end = new Date(endAt).getTime();

    return [...this.events.values()].filter((e) => {
      if (e.tenantId !== tenantId) return false;
      if (e.status === 'cancelled') return false;
      if (excludeEventId && e.id === excludeEventId) return false;

      const isParticipant =
        participantIds.includes(e.createdBy) ||
        e.attendees.some(
          (a) =>
            (a.userId && participantIds.includes(a.userId)) ||
            (a.customerId && participantIds.includes(a.customerId))
        );
      if (!isParticipant) return false;

      const eStart = new Date(e.startAt).getTime();
      const eEnd = new Date(e.endAt).getTime();
      const eBufferBefore = e.bufferMinutesBefore * 60_000;
      const eBufferAfter = e.bufferMinutesAfter * 60_000;
      const eEffectiveStart = eStart - eBufferBefore;
      const eEffectiveEnd = eEnd + eBufferAfter;

      return start < eEffectiveEnd && end > eEffectiveStart;
    });
  }
}

// ============================================================================
// Working Hours Repository
// ============================================================================

export class InMemoryWorkingHoursRepository implements WorkingHoursRepository {
  private workingHours = new Map<string, WorkingHours>();

  private key(userId: UserId, tenantId: TenantId): string {
    return `${tenantId}:${userId}`;
  }

  async getForUser(userId: UserId, tenantId: TenantId): Promise<WorkingHours | null> {
    return this.workingHours.get(this.key(userId, tenantId)) ?? null;
  }

  async setForUser(
    userId: UserId,
    tenantId: TenantId,
    workingHours: WorkingHours
  ): Promise<WorkingHours> {
    this.workingHours.set(this.key(userId, tenantId), workingHours);
    return workingHours;
  }
}

// ============================================================================
// Availability Repository
// ============================================================================

export class InMemoryAvailabilityRepository implements AvailabilityRepository {
  private availability = new Map<string, Availability>();

  private key(tenantId: TenantId, userId: UserId, date: string): string {
    return `${tenantId}:${userId}:${date}`;
  }

  async get(tenantId: TenantId, userId: UserId, date: string): Promise<Availability | null> {
    return this.availability.get(this.key(tenantId, userId, date)) ?? null;
  }

  async set(tenantId: TenantId, availability: Availability): Promise<Availability> {
    const key = this.key(tenantId, availability.userId, availability.date);
    this.availability.set(key, availability);
    return availability;
  }

  async getRange(
    tenantId: TenantId,
    userId: UserId,
    start: ISOTimestamp,
    end: ISOTimestamp
  ): Promise<readonly Availability[]> {
    const startDate = start.slice(0, 10);
    const endDate = end.slice(0, 10);
    const result: Availability[] = [];
    const prefix = `${tenantId}:${userId}:`;

    for (const [key, av] of this.availability) {
      if (!key.startsWith(prefix)) continue;
      if (av.date >= startDate && av.date <= endDate) {
        result.push(av);
      }
    }

    return result.sort((a, b) => a.date.localeCompare(b.date));
  }
}
