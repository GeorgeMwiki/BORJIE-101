/**
 * Scheduling domain events
 *
 * Events emitted when schedule events are created, cancelled, or reminders sent.
 */

import type { TenantId, UserId, ISOTimestamp } from '@borjie/domain-models';
import type { ScheduleEventId, ScheduleEventType } from './types.js';

/** Base structure for scheduling events */
interface SchedulingEventBase {
  readonly eventId: string;
  readonly timestamp: ISOTimestamp;
  readonly tenantId: TenantId;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly metadata: Record<string, unknown>;
}

/** Emitted when a new schedule event is created */
export interface EventScheduledEvent extends SchedulingEventBase {
  readonly eventType: 'EventScheduled';
  readonly payload: {
    readonly eventId: ScheduleEventId;
    readonly type: ScheduleEventType;
    readonly title: string;
    readonly startAt: ISOTimestamp;
    readonly endAt: ISOTimestamp;
    readonly attendees: readonly { userId?: UserId; customerId?: string; name: string }[];
    readonly propertyId: string | null;
    readonly unitId: string | null;
    readonly customerId: string | null;
    readonly createdBy: UserId;
  };
}

/** Emitted when a schedule event is cancelled */
export interface EventCancelledEvent extends SchedulingEventBase {
  readonly eventType: 'EventCancelled';
  readonly payload: {
    readonly eventId: ScheduleEventId;
    readonly type: ScheduleEventType;
    readonly title: string;
    readonly startAt: ISOTimestamp;
    readonly reason: string;
    readonly cancelledBy: UserId;
  };
}

/** Emitted when a reminder is sent for a schedule event */
export interface EventReminderSentEvent extends SchedulingEventBase {
  readonly eventType: 'EventReminderSent';
  readonly payload: {
    readonly eventId: ScheduleEventId;
    readonly type: ScheduleEventType;
    readonly title: string;
    readonly startAt: ISOTimestamp;
    readonly recipients: readonly string[];
    readonly channel: 'sms' | 'email' | 'push' | 'whatsapp';
  };
}
