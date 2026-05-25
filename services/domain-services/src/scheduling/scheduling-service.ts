// @ts-nocheck — domain-models drift (WorkOrder/Block namespace shape, Money class, TenantStatus enum); tracked
import { randomHex } from '../common/id-generator.js';
/**
 * Scheduling/Calendar Service
 *
 * For estate managers to schedule property viewings, inspections,
 * maintenance visits, and tenant meetings.
 */

import type {
  TenantId,
  UserId,
  ISOTimestamp,
  PaginationParams,
  PaginatedResult,
  Result,
} from '@borjie/domain-models';
import { ok, err } from '@borjie/domain-models';
import type { EventBus } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';
import type {
  ScheduleEvent,
  ScheduleEventId,
  ScheduleEventType,
  ScheduleEventFilters,
  CreateEventInput,
  UpdateEventInput,
  EventAttendee,
  TimeSlot,
  Availability,
  AvailabilityWithWorkingHours,
  WorkingHours,
  GetEventsFilters,
  EventReminder,
} from './types.js';
import { asScheduleEventId, DEFAULT_WORKING_HOURS } from './types.js';
import type {
  EventScheduledEvent,
  EventCancelledEvent,
  EventReminderSentEvent,
} from './events.js';
import type {
  SchedulingRepository,
  WorkingHoursRepository,
  AvailabilityRepository,
} from './scheduling-repository.interface.js';

// ============================================================================
// Error Types
// ============================================================================

export const SchedulingServiceError = {
  EVENT_NOT_FOUND: 'EVENT_NOT_FOUND',
  EVENT_ALREADY_CANCELLED: 'EVENT_ALREADY_CANCELLED',
  CONFLICT_DETECTED: 'CONFLICT_DETECTED',
  INVALID_DATE_RANGE: 'INVALID_DATE_RANGE',
  REMINDER_ALREADY_SENT: 'REMINDER_ALREADY_SENT',
} as const;

export type SchedulingServiceErrorCode =
  (typeof SchedulingServiceError)[keyof typeof SchedulingServiceError];

export interface SchedulingServiceErrorResult {
  code: SchedulingServiceErrorCode;
  message: string;
}

// ============================================================================
// Default timezone
// ============================================================================

// No country hardcoded — when a tenant's timezone is not set, fall
// back to UTC. The region-config registry resolves the proper default
// from tenant.country at creation time (see createTenant in domain-models).
export const DEFAULT_TIMEZONE = 'UTC';

// ============================================================================
// Scheduling Service
// ============================================================================

export class SchedulingService {
  constructor(
    private readonly repo: SchedulingRepository,
    private readonly workingHoursRepo: WorkingHoursRepository,
    private readonly availabilityRepo: AvailabilityRepository,
    private readonly eventBus: EventBus,
    private readonly options?: {
      defaultBufferMinutes?: number;
      defaultReminderMinutes?: number;
    }
  ) {}

  private get bufferMinutes(): number {
    return this.options?.defaultBufferMinutes ?? 15;
  }

  private get reminderMinutes(): number {
    return this.options?.defaultReminderMinutes ?? 60;
  }

  /**
   * Create a new schedule event.
   */
  async createEvent(
    tenantId: TenantId,
    type: ScheduleEventType,
    details: Omit<CreateEventInput, 'type'>,
    attendees: EventAttendee[],
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<ScheduleEvent, SchedulingServiceErrorResult>> {
    const durationMinutes =
      details.durationMinutes ??
      (details.endAt && details.startAt
        ? Math.round(
            (new Date(details.endAt).getTime() - new Date(details.startAt).getTime()) /
              60_000
          )
        : 60);

    const endAt =
      details.endAt ??
      this.addMinutes(details.startAt, durationMinutes);

    const effectiveStart = this.addMinutes(
      details.startAt,
      -(details.bufferMinutesBefore ?? this.bufferMinutes)
    );
    const effectiveEnd = this.addMinutes(
      endAt,
      details.bufferMinutesAfter ?? this.bufferMinutes
    );

    const participantIds = this.extractParticipantIds(attendees);
    participantIds.push(createdBy);

    const conflicts = await this.repo.findConflicting(
      tenantId,
      participantIds,
      effectiveStart,
      effectiveEnd
    );

    if (conflicts.length > 0) {
      return err({
        code: SchedulingServiceError.CONFLICT_DETECTED,
        message: `Conflict with existing event(s): ${conflicts.map((c) => c.title).join(', ')}`,
      });
    }

    const now = new Date().toISOString();
    const eventId = asScheduleEventId(
      `evt_${Date.now()}_${randomHex(4)}`
    );

    const event: ScheduleEvent = {
      id: eventId,
      tenantId,
      type,
      title: details.title,
      description: details.description ?? null,
      startAt: details.startAt,
      endAt,
      durationMinutes,
      attendees: attendees as readonly EventAttendee[],
      timezone: DEFAULT_TIMEZONE,
      location: details.location ?? null,
      propertyId: details.propertyId ?? null,
      unitId: details.unitId ?? null,
      customerId: details.customerId ?? null,
      workOrderId: details.workOrderId ?? null,
      recurrenceRule: details.recurrenceRule ?? null,
      bufferMinutesBefore: details.bufferMinutesBefore ?? this.bufferMinutes,
      bufferMinutesAfter: details.bufferMinutesAfter ?? this.bufferMinutes,
      status: 'scheduled',
      reminderSentAt: null,
      cancelledAt: null,
      cancellationReason: null,
      completedAt: null,
      syncStatus: 'pending',
      metadata: {},
      createdAt: now,
      updatedAt: now,
      createdBy,
      updatedBy: createdBy,
    };

    const saved = await this.repo.create(event);

    const scheduledEvent: EventScheduledEvent = {
      eventId: generateEventId(),
      eventType: 'EventScheduled',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        eventId: saved.id,
        type: saved.type,
        title: saved.title,
        startAt: saved.startAt,
        endAt: saved.endAt,
        attendees: saved.attendees.map((a) => ({
          userId: a.userId,
          customerId: a.customerId,
          name: a.name,
        })),
        propertyId: saved.propertyId,
        unitId: saved.unitId,
        customerId: saved.customerId,
        createdBy: saved.createdBy,
      },
    };
    await this.eventBus.publish(
      createEventEnvelope(scheduledEvent, saved.id, 'ScheduleEvent')
    );

    return ok(saved);
  }

  /**
   * Update an existing event.
   */
  async updateEvent(
    eventId: ScheduleEventId,
    tenantId: TenantId,
    updates: UpdateEventInput,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<ScheduleEvent, SchedulingServiceErrorResult>> {
    const existing = await this.repo.findById(eventId, tenantId);
    if (!existing) {
      return err({
        code: SchedulingServiceError.EVENT_NOT_FOUND,
        message: 'Event not found',
      });
    }
    if (existing.status === 'cancelled') {
      return err({
        code: SchedulingServiceError.EVENT_ALREADY_CANCELLED,
        message: 'Cannot update cancelled event',
      });
    }

    const startAt = updates.startAt ?? existing.startAt;
    const durationMinutes =
      updates.durationMinutes ??
      (updates.endAt && startAt
        ? Math.round(
            (new Date(updates.endAt).getTime() - new Date(startAt).getTime()) /
              60_000
          )
        : existing.durationMinutes);
    const endAt =
      updates.endAt ?? this.addMinutes(startAt, durationMinutes);

    const effectiveStart = this.addMinutes(
      startAt,
      -(updates.bufferMinutesBefore ?? existing.bufferMinutesBefore)
    );
    const effectiveEnd = this.addMinutes(
      endAt,
      updates.bufferMinutesAfter ?? existing.bufferMinutesAfter
    );

    const attendees = updates.attendees ?? existing.attendees;
    const participantIds = this.extractParticipantIds(attendees);
    participantIds.push(updatedBy);

    const conflicts = await this.repo.findConflicting(
      tenantId,
      participantIds,
      effectiveStart,
      effectiveEnd,
      eventId
    );

    if (conflicts.length > 0) {
      return err({
        code: SchedulingServiceError.CONFLICT_DETECTED,
        message: `Conflict with existing event(s): ${conflicts.map((c) => c.title).join(', ')}`,
      });
    }

    const now = new Date().toISOString();
    const updated: ScheduleEvent = {
      ...existing,
      title: updates.title ?? existing.title,
      description: updates.description ?? existing.description ?? null,
      startAt,
      endAt,
      durationMinutes,
      attendees: (updates.attendees ?? existing.attendees) as readonly EventAttendee[],
      location: updates.location ?? existing.location ?? null,
      bufferMinutesBefore: updates.bufferMinutesBefore ?? existing.bufferMinutesBefore,
      bufferMinutesAfter: updates.bufferMinutesAfter ?? existing.bufferMinutesAfter,
      updatedAt: now,
      updatedBy,
    };

    const saved = await this.repo.update(updated);
    return ok(saved);
  }

  /**
   * Cancel an event with a reason.
   */
  async cancelEvent(
    eventId: ScheduleEventId,
    tenantId: TenantId,
    reason: string,
    cancelledBy: UserId,
    correlationId: string
  ): Promise<Result<ScheduleEvent, SchedulingServiceErrorResult>> {
    const existing = await this.repo.findById(eventId, tenantId);
    if (!existing) {
      return err({
        code: SchedulingServiceError.EVENT_NOT_FOUND,
        message: 'Event not found',
      });
    }
    if (existing.status === 'cancelled') {
      return err({
        code: SchedulingServiceError.EVENT_ALREADY_CANCELLED,
        message: 'Event is already cancelled',
      });
    }

    const now = new Date().toISOString();
    const updated: ScheduleEvent = {
      ...existing,
      status: 'cancelled',
      cancelledAt: now,
      cancellationReason: reason,
      updatedAt: now,
      updatedBy: cancelledBy,
    };

    const saved = await this.repo.update(updated);

    const cancelledEvent: EventCancelledEvent = {
      eventId: generateEventId(),
      eventType: 'EventCancelled',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        eventId: saved.id,
        type: saved.type,
        title: saved.title,
        startAt: saved.startAt,
        reason,
        cancelledBy,
      },
    };
    await this.eventBus.publish(
      createEventEnvelope(cancelledEvent, saved.id, 'ScheduleEvent')
    );

    return ok(saved);
  }

  /**
   * Get availability for a user on a given date.
   */
  async getAvailability(
    tenantId: TenantId,
    userId: UserId,
    dateRange: { start: ISOTimestamp; end: ISOTimestamp },
    durationMinutes = 60
  ): Promise<Result<readonly Availability[], SchedulingServiceErrorResult>> {
    const start = new Date(dateRange.start);
    const end = new Date(dateRange.end);

    if (start > end) {
      return err({
        code: SchedulingServiceError.INVALID_DATE_RANGE,
        message: 'Start date must be before or equal to end date',
      });
    }

    const results: Availability[] = [];
    const current = new Date(start);
    current.setHours(0, 0, 0, 0);

    while (current <= end) {
      const dateStr = current.toISOString().slice(0, 10);
      const singleDateResult = await this.getAvailabilityForDate(
        userId,
        tenantId,
        dateStr as ISOTimestamp,
        durationMinutes
      );
      if (singleDateResult.success) {
        results.push({
          userId,
          date: dateStr,
          timeSlots: singleDateResult.data.slots,
          timezone: singleDateResult.data.timezone,
          workingHours: singleDateResult.data.workingHours,
        });
      }
      current.setDate(current.getDate() + 1);
    }

    return ok(results);
  }

  /**
   * Get availability for a user on a single date (uses working hours + events).
   */
  async getAvailabilityForDate(
    userId: UserId,
    tenantId: TenantId,
    date: ISOTimestamp,
    durationMinutes: number
  ): Promise<Result<AvailabilityWithWorkingHours, SchedulingServiceErrorResult>> {
    const workingHours =
      (await this.workingHoursRepo.getForUser(userId, tenantId)) ??
      DEFAULT_WORKING_HOURS;

    const dateStr = date.slice(0, 10);
    const dayOfWeek = new Date(date).getDay();
    const daySchedule = this.getDaySchedule(workingHours, dayOfWeek);

    if (!daySchedule) {
      return ok({
        userId,
        date: dateStr,
        timezone: workingHours.timezone,
        slots: [],
        workingHours,
      });
    }

    const dayStart = new Date(`${dateStr}T${daySchedule.start}`);
    const dayEnd = new Date(`${dateStr}T${daySchedule.end}`);

    const existingEvents = await this.repo.findByUserId(
      userId,
      tenantId,
      dayStart.toISOString(),
      dayEnd.toISOString()
    );

    const slots = this.generateSlots(
      dayStart,
      dayEnd,
      durationMinutes,
      existingEvents,
      this.bufferMinutes
    );

    return ok({
      userId,
      date: dateStr,
      timezone: workingHours.timezone,
      slots,
      workingHours,
    });
  }

  /**
   * Set user-defined availability (overrides working hours for specific dates).
   */
  async setAvailability(
    tenantId: TenantId,
    userId: UserId,
    availability: Availability
  ): Promise<Result<Availability, SchedulingServiceErrorResult>> {
    const toStore: Availability = {
      ...availability,
      userId,
      date: availability.date,
      timeSlots: availability.timeSlots,
    };
    const saved = await this.availabilityRepo.set(tenantId, toStore);
    return ok(saved);
  }

  /**
   * Find available time slots for multiple participants.
   */
  async findAvailableSlots(
    tenantId: TenantId,
    participants: readonly UserId[],
    durationMinutes: number,
    dateRange: { start: ISOTimestamp; end: ISOTimestamp }
  ): Promise<Result<readonly TimeSlot[], SchedulingServiceErrorResult>> {
    const start = new Date(dateRange.start);
    const end = new Date(dateRange.end);

    if (start >= end) {
      return err({
        code: SchedulingServiceError.INVALID_DATE_RANGE,
        message: 'Start date must be before end date',
      });
    }

    const workingHours =
      (await this.workingHoursRepo.getForUser(participants[0], tenantId)) ??
      DEFAULT_WORKING_HOURS;

    const allSlots: TimeSlot[] = [];
    const current = new Date(start);
    current.setHours(0, 0, 0, 0);

    while (current < end) {
      const dateStr = current.toISOString().slice(0, 10);
      const dayOfWeek = current.getDay();
      const daySchedule = this.getDaySchedule(workingHours, dayOfWeek);

      if (daySchedule) {
        const dayStart = new Date(`${dateStr}T${daySchedule.start}`);
        const dayEnd = new Date(`${dateStr}T${daySchedule.end}`);

        const participantEvents: ScheduleEvent[] = [];
        for (const userId of participants) {
          const events = await this.repo.findByUserId(
            userId,
            tenantId,
            dayStart.toISOString(),
            dayEnd.toISOString()
          );
          participantEvents.push(...events);
        }

        const slots = this.generateSlots(
          dayStart,
          dayEnd,
          durationMinutes,
          participantEvents,
          this.bufferMinutes
        );

        for (const slot of slots) {
          if (slot.available) {
            allSlots.push(slot);
          }
        }
      }

      current.setDate(current.getDate() + 1);
    }

    return ok(allSlots);
  }

  /**
   * List events with filters.
   */
  async listEvents(
    tenantId: TenantId,
    filters: ScheduleEventFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<ScheduleEvent>> {
    return this.repo.list(tenantId, filters, pagination);
  }

  /**
   * Get events with filters (dateRange, type, propertyId, userId).
   */
  async getEvents(
    tenantId: TenantId,
    filters: GetEventsFilters,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<ScheduleEvent>> {
    const scheduleFilters: ScheduleEventFilters = {
      type: filters.type,
      propertyId: filters.propertyId,
      unitId: filters.unitId,
      userId: filters.userId,
      startFrom: filters.dateRange?.start,
      startTo: filters.dateRange?.end,
    };
    return this.repo.list(tenantId, scheduleFilters, pagination);
  }

  /**
   * Get upcoming events for a user.
   */
  async getUpcomingEvents(
    tenantId: TenantId,
    userId: UserId,
    days = 7
  ): Promise<readonly ScheduleEvent[]> {
    const now = new Date();
    const future = new Date(now);
    future.setDate(future.getDate() + days);
    const events = await this.repo.findByUserId(
      userId,
      tenantId,
      now.toISOString(),
      future.toISOString()
    );

    return events
      .filter((e) => e.status !== 'cancelled')
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  }

  /**
   * Schedule a reminder for an event at a specific time via a channel.
   */
  async scheduleReminder(
    eventId: ScheduleEventId,
    tenantId: TenantId,
    reminderTime: ISOTimestamp,
    channel: 'sms' | 'email' | 'push' | 'whatsapp',
    correlationId: string
  ): Promise<Result<ScheduleEvent, SchedulingServiceErrorResult>> {
    const event = await this.repo.findById(eventId, tenantId);
    if (!event) {
      return err({
        code: SchedulingServiceError.EVENT_NOT_FOUND,
        message: 'Event not found',
      });
    }
    if (event.status === 'cancelled') {
      return err({
        code: SchedulingServiceError.EVENT_ALREADY_CANCELLED,
        message: 'Cannot schedule reminder for cancelled event',
      });
    }

    const reminder: EventReminder = { time: reminderTime, channel };
    const existingReminders = (event.metadata?.reminders as EventReminder[]) ?? [];
    const updated: ScheduleEvent = {
      ...event,
      metadata: {
        ...event.metadata,
        reminders: [...existingReminders, reminder],
      },
      updatedAt: new Date().toISOString(),
    };

    const saved = await this.repo.update(updated);
    return ok(saved);
  }

  /**
   * Send reminders for an event (triggers notification).
   */
  async sendReminders(
    eventId: ScheduleEventId,
    tenantId: TenantId,
    correlationId: string
  ): Promise<Result<ScheduleEvent, SchedulingServiceErrorResult>> {
    const event = await this.repo.findById(eventId, tenantId);
    if (!event) {
      return err({
        code: SchedulingServiceError.EVENT_NOT_FOUND,
        message: 'Event not found',
      });
    }
    if (event.status === 'cancelled') {
      return err({
        code: SchedulingServiceError.EVENT_ALREADY_CANCELLED,
        message: 'Cannot send reminder for cancelled event',
      });
    }
    if (event.reminderSentAt) {
      return err({
        code: SchedulingServiceError.REMINDER_ALREADY_SENT,
        message: 'Reminder already sent for this event',
      });
    }

    const recipients = event.attendees
      .map((a) => (a.email ?? a.userId ?? a.customerId) as string)
      .filter(Boolean);

    const now = new Date().toISOString();
    const updated: ScheduleEvent = {
      ...event,
      reminderSentAt: now,
      updatedAt: now,
      updatedBy: event.updatedBy,
    };

    const saved = await this.repo.update(updated);

    const reminderEvent: EventReminderSentEvent = {
      eventId: generateEventId(),
      eventType: 'EventReminderSent',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        eventId: saved.id,
        type: saved.type,
        title: saved.title,
        startAt: saved.startAt,
        recipients,
        channel: 'email',
      },
    };
    await this.eventBus.publish(
      createEventEnvelope(reminderEvent, saved.id, 'ScheduleEvent')
    );

    return ok(saved);
  }

  /**
   * Mark event as completed and sync status.
   */
  async completeEvent(
    eventId: ScheduleEventId,
    tenantId: TenantId,
    completedBy: UserId
  ): Promise<Result<ScheduleEvent, SchedulingServiceErrorResult>> {
    const existing = await this.repo.findById(eventId, tenantId);
    if (!existing) {
      return err({
        code: SchedulingServiceError.EVENT_NOT_FOUND,
        message: 'Event not found',
      });
    }
    if (existing.status === 'cancelled') {
      return err({
        code: SchedulingServiceError.EVENT_ALREADY_CANCELLED,
        message: 'Cannot complete cancelled event',
      });
    }

    const now = new Date().toISOString();
    const updated: ScheduleEvent = {
      ...existing,
      status: 'completed',
      completedAt: now,
      syncStatus: 'synced',
      updatedAt: now,
      updatedBy: completedBy,
    };

    const saved = await this.repo.update(updated);
    return ok(saved);
  }

  /**
   * Get event by ID.
   */
  async getEvent(
    eventId: ScheduleEventId,
    tenantId: TenantId
  ): Promise<Result<ScheduleEvent, SchedulingServiceErrorResult>> {
    const event = await this.repo.findById(eventId, tenantId);
    if (!event) {
      return err({
        code: SchedulingServiceError.EVENT_NOT_FOUND,
        message: 'Event not found',
      });
    }
    return ok(event);
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private addMinutes(iso: ISOTimestamp, minutes: number): ISOTimestamp {
    const d = new Date(iso);
    d.setMinutes(d.getMinutes() + minutes);
    return d.toISOString();
  }

  private extractParticipantIds(attendees: readonly EventAttendee[]): string[] {
    const ids: string[] = [];
    for (const a of attendees) {
      if (a.userId) ids.push(a.userId);
      if (a.customerId) ids.push(a.customerId);
    }
    return ids;
  }

  private getDaySchedule(
    wh: WorkingHours,
    dayOfWeek: number
  ): { start: string; end: string } | null {
    const key = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
      dayOfWeek
    ] as keyof typeof wh;
    return wh[key] ?? null;
  }

  private generateSlots(
    dayStart: Date,
    dayEnd: Date,
    durationMinutes: number,
    existingEvents: readonly ScheduleEvent[],
    bufferMinutes: number
  ): TimeSlot[] {
    const slots: TimeSlot[] = [];
    const slotDurationMs = durationMinutes * 60_000;
    const bufferMs = bufferMinutes * 60_000;
    let current = dayStart.getTime();

    while (current + slotDurationMs <= dayEnd.getTime()) {
      const slotStart = new Date(current);
      const slotEnd = new Date(current + slotDurationMs);
      const effectiveStart = current - bufferMs;
      const effectiveEnd = current + slotDurationMs + bufferMs;

      const hasConflict = existingEvents.some((e) => {
        const eStart = new Date(e.startAt).getTime();
        const eEnd = new Date(e.endAt).getTime();
        const eBufferBefore = e.bufferMinutesBefore * 60_000;
        const eBufferAfter = e.bufferMinutesAfter * 60_000;
        const eEffectiveStart = eStart - eBufferBefore;
        const eEffectiveEnd = eEnd + eBufferAfter;
        return (
          (effectiveStart < eEffectiveEnd && effectiveEnd > eEffectiveStart) ||
          (eEffectiveStart < effectiveEnd && eEffectiveEnd > effectiveStart)
        );
      });

      slots.push({
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
        available: !hasConflict,
      });

      current += 30 * 60_000;
    }

    return slots;
  }
}
