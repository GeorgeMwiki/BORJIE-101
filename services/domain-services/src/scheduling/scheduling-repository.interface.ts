/**
 * Scheduling repository interface
 *
 * Abstract interface for schedule event persistence.
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

export interface SchedulingRepository {
  findById(id: ScheduleEventId, tenantId: TenantId): Promise<ScheduleEvent | null>;
  create(event: ScheduleEvent): Promise<ScheduleEvent>;
  update(event: ScheduleEvent): Promise<ScheduleEvent>;
  list(
    tenantId: TenantId,
    filters: ScheduleEventFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<ScheduleEvent>>;
  findByUserId(
    userId: UserId,
    tenantId: TenantId,
    fromDate: ISOTimestamp,
    toDate: ISOTimestamp
  ): Promise<readonly ScheduleEvent[]>;
  findConflicting(
    tenantId: TenantId,
    participantIds: readonly string[],
    startAt: ISOTimestamp,
    endAt: ISOTimestamp,
    excludeEventId?: ScheduleEventId
  ): Promise<readonly ScheduleEvent[]>;
}

export interface WorkingHoursRepository {
  getForUser(userId: UserId, tenantId: TenantId): Promise<WorkingHours | null>;
  setForUser(
    userId: UserId,
    tenantId: TenantId,
    workingHours: WorkingHours
  ): Promise<WorkingHours>;
}

/** User-defined availability (override working hours for specific dates) */
export interface AvailabilityRepository {
  get(tenantId: TenantId, userId: UserId, date: string): Promise<Availability | null>;
  set(tenantId: TenantId, availability: Availability): Promise<Availability>;
  getRange(
    tenantId: TenantId,
    userId: UserId,
    start: ISOTimestamp,
    end: ISOTimestamp
  ): Promise<readonly Availability[]>;
}
