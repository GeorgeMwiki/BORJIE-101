// @ts-nocheck — domain-models drift (WorkOrder/Block namespace shape, Money class, TenantStatus enum); tracked
/**
 * Scheduling domain types
 *
 * Types for estate manager scheduling: property viewings, inspections,
 * maintenance visits, tenant meetings.
 */

import type {
  TenantId,
  UserId,
  ISOTimestamp,
  PaginationParams,
  PaginatedResult,
  PropertyId,
  UnitId,
  CustomerId,
} from '@borjie/domain-models';
import type { WorkOrderId } from '@borjie/domain-models';

// ============================================================================
// Branded IDs
// ============================================================================

export type ScheduleEventId = string & { __brand: 'ScheduleEventId' };

export function asScheduleEventId(id: string): ScheduleEventId {
  return id as ScheduleEventId;
}

// ============================================================================
// Event Types
// ============================================================================

export const EVENT_TYPES = [
  'inspection',
  'maintenance',
  'viewing',
  'meeting',
  'move_in',
  'move_out',
  'lease_signing',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export type ScheduleEventType =
  | 'viewing' // Property viewings
  | 'inspection' // Inspections
  | 'maintenance' // Maintenance visits
  | 'meeting' // Tenant meetings
  | 'move_in'
  | 'move_out'
  | 'lease_signing';

// ============================================================================
// Recurrence
// ============================================================================

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurrenceRule {
  readonly frequency: RecurrenceFrequency;
  readonly interval: number; // Every N days/weeks/months/years
  readonly daysOfWeek?: number[]; // 0=Sun, 1=Mon, ... 6=Sat
  readonly dayOfMonth?: number; // 1-31 for monthly
  readonly monthOfYear?: number; // 1-12 for yearly
  readonly endDate?: ISOTimestamp;
  readonly occurrenceCount?: number; // Max occurrences
}

// ============================================================================
// Attendees & Participants
// ============================================================================

export type AttendeeRole = 'organizer' | 'required' | 'optional';

export interface EventAttendee {
  readonly userId?: UserId;
  readonly customerId?: CustomerId;
  readonly email?: string;
  readonly name: string;
  readonly role: AttendeeRole;
  readonly status?: 'pending' | 'accepted' | 'declined';
}

// ============================================================================
// Schedule Event
// ============================================================================

export type ScheduleEventStatus =
  | 'scheduled'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export interface ScheduleEvent {
  readonly id: ScheduleEventId;
  readonly tenantId: TenantId;
  readonly type: ScheduleEventType;
  readonly title: string;
  readonly description: string | null;
  readonly startAt: ISOTimestamp;
  readonly endAt: ISOTimestamp;
  readonly durationMinutes: number;
  readonly attendees: readonly EventAttendee[];
  readonly timezone: string; // IANA timezone — sourced from getJurisdictionalRules(tenant.country).defaultTimezone
  readonly location: string | null;
  readonly propertyId: PropertyId | null;
  readonly unitId: UnitId | null;
  readonly customerId: CustomerId | null;
  readonly workOrderId: WorkOrderId | null; // For maintenance events
  readonly recurrenceRule: RecurrenceRule | null;
  readonly bufferMinutesBefore: number;
  readonly bufferMinutesAfter: number;
  readonly status: ScheduleEventStatus;
  readonly reminderSentAt: ISOTimestamp | null;
  readonly cancelledAt: ISOTimestamp | null;
  readonly cancellationReason: string | null;
  readonly completedAt: ISOTimestamp | null;
  readonly syncStatus: 'pending' | 'synced' | 'failed';
  readonly metadata: Record<string, unknown>;
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
  readonly createdBy: UserId;
  readonly updatedBy: UserId;
}

// ============================================================================
// Time Slots & Availability
// ============================================================================

export interface TimeSlot {
  readonly start: ISOTimestamp;
  readonly end: ISOTimestamp;
  readonly available: boolean;
}

/** Availability for a user on a specific date */
export interface Availability {
  readonly userId: UserId;
  readonly date: string; // Date in YYYY-MM-DD
  readonly timeSlots: readonly TimeSlot[];
  readonly timezone?: string;
  readonly workingHours?: WorkingHours | null;
}

/** Availability with working hours (used by getAvailability) */
export interface AvailabilityWithWorkingHours {
  readonly userId: UserId;
  readonly date: string;
  readonly timezone: string;
  readonly slots: readonly TimeSlot[];
  readonly workingHours: WorkingHours | null;
}

// ============================================================================
// Scheduled Event (Public API)
// ============================================================================

export interface EventReminder {
  readonly time: ISOTimestamp;
  readonly channel: 'sms' | 'email' | 'push' | 'whatsapp';
}

export interface EventParticipant {
  readonly userId?: UserId;
  readonly customerId?: string;
  readonly name: string;
  readonly email?: string;
}

/** Public ScheduledEvent shape - id, tenantId, type, title, etc. */
export interface ScheduledEvent {
  readonly id: ScheduleEventId;
  readonly tenantId: TenantId;
  readonly type: EventType;
  readonly title: string;
  readonly description: string | null;
  readonly propertyId: PropertyId | null;
  readonly unitId: UnitId | null;
  readonly startTime: ISOTimestamp;
  readonly endTime: ISOTimestamp;
  readonly participants: readonly EventParticipant[];
  readonly location: string | null;
  readonly status: ScheduleEventStatus;
  readonly reminders: readonly EventReminder[];
}

// ============================================================================
// Working Hours Configuration
// ============================================================================

export interface WorkingHours {
  readonly timezone: string;
  readonly monday: DaySchedule | null;
  readonly tuesday: DaySchedule | null;
  readonly wednesday: DaySchedule | null;
  readonly thursday: DaySchedule | null;
  readonly friday: DaySchedule | null;
  readonly saturday: DaySchedule | null;
  readonly sunday: DaySchedule | null;
}

export interface DaySchedule {
  readonly start: string; // HH:mm
  readonly end: string;   // HH:mm
}

// Default working hours — timezone is UTC until the tenant's
// `tenant.defaultTimezone` is loaded; callers should override with the
// tenant-resolved timezone from `getRegionConfig(tenant.countryCode)`.
export const DEFAULT_WORKING_HOURS: WorkingHours = {
  timezone: 'UTC',
  monday: { start: '08:00', end: '17:00' },
  tuesday: { start: '08:00', end: '17:00' },
  wednesday: { start: '08:00', end: '17:00' },
  thursday: { start: '08:00', end: '17:00' },
  friday: { start: '08:00', end: '17:00' },
  saturday: { start: '09:00', end: '13:00' },
  sunday: null,
};

// ============================================================================
// Input Types
// ============================================================================

export interface CreateEventInput {
  type: ScheduleEventType;
  title: string;
  description?: string;
  startAt: ISOTimestamp;
  endAt?: ISOTimestamp;
  durationMinutes?: number;
  attendees?: EventAttendee[];
  location?: string;
  propertyId?: PropertyId;
  unitId?: UnitId;
  customerId?: CustomerId;
  workOrderId?: WorkOrderId;
  recurrenceRule?: RecurrenceRule;
  bufferMinutesBefore?: number;
  bufferMinutesAfter?: number;
}

export interface UpdateEventInput {
  title?: string;
  description?: string;
  startAt?: ISOTimestamp;
  endAt?: ISOTimestamp;
  durationMinutes?: number;
  attendees?: EventAttendee[];
  location?: string;
  bufferMinutesBefore?: number;
  bufferMinutesAfter?: number;
}

// ============================================================================
// Filters
// ============================================================================

export interface ScheduleEventFilters {
  type?: ScheduleEventType | ScheduleEventType[];
  status?: ScheduleEventStatus | ScheduleEventStatus[];
  propertyId?: PropertyId;
  unitId?: UnitId;
  customerId?: CustomerId;
  userId?: UserId; // Attendee
  startFrom?: ISOTimestamp;
  startTo?: ISOTimestamp;
}

/** Filters for getEvents - dateRange, type, propertyId, userId */
export interface GetEventsFilters {
  dateRange?: { start: ISOTimestamp; end: ISOTimestamp };
  type?: EventType | EventType[];
  propertyId?: PropertyId;
  userId?: UserId;
  unitId?: UnitId;
}
