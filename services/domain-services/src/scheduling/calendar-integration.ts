/**
 * Calendar integration points
 *
 * Interfaces for Google Calendar sync and iCal export.
 */

import type { TenantId, UserId, ISOTimestamp } from '@borjie/domain-models';
import type { ScheduledEvent } from './types.js';

// ============================================================================
// Google Calendar Sync Interface
// ============================================================================

/** Result of a sync operation */
export interface GoogleCalendarSyncResult {
  readonly success: boolean;
  readonly syncedCount: number;
  readonly failedCount: number;
  readonly errors?: readonly { eventId: string; message: string }[];
}

/** Event data for Google Calendar API */
export interface GoogleCalendarEventInput {
  readonly summary: string;
  readonly description?: string;
  readonly start: { dateTime: ISOTimestamp; timeZone?: string };
  readonly end: { dateTime: ISOTimestamp; timeZone?: string };
  readonly location?: string;
  readonly attendees?: readonly { email: string }[];
  readonly status?: 'confirmed' | 'tentative' | 'cancelled';
}

/**
 * Google Calendar sync interface.
 * Implement this to integrate with Google Calendar API for bidirectional sync.
 */
export interface GoogleCalendarSyncProvider {
  /**
   * Push local events to Google Calendar.
   * Creates or updates events in the user's Google Calendar.
   */
  pushEvents(
    tenantId: TenantId,
    userId: UserId,
    events: readonly ScheduledEvent[],
    calendarId?: string
  ): Promise<GoogleCalendarSyncResult>;

  /**
   * Pull events from Google Calendar into the local system.
   * Reads events from the user's Google Calendar for the given date range.
   */
  pullEvents(
    tenantId: TenantId,
    userId: UserId,
    dateRange: { start: ISOTimestamp; end: ISOTimestamp },
    calendarId?: string
  ): Promise<readonly GoogleCalendarEventInput[]>;

  /**
   * Delete an event from Google Calendar (e.g. when cancelled locally).
   */
  deleteEvent(
    tenantId: TenantId,
    userId: UserId,
    googleEventId: string,
    calendarId?: string
  ): Promise<boolean>;

  /**
   * Check if the user has connected their Google Calendar.
   */
  isConnected(tenantId: TenantId, userId: UserId): Promise<boolean>;

  /**
   * Get the OAuth URL to initiate connection.
   */
  getAuthUrl(tenantId: TenantId, userId: UserId, redirectUri: string): Promise<string>;

  /**
   * Complete OAuth flow and store tokens.
   */
  completeAuth(
    tenantId: TenantId,
    userId: UserId,
    authCode: string,
    redirectUri: string
  ): Promise<void>;

  /**
   * Disconnect Google Calendar for the user.
   */
  disconnect(tenantId: TenantId, userId: UserId): Promise<void>;
}

// ============================================================================
// iCal Export
// ============================================================================

/** Options for iCal export */
export interface ICalExportOptions {
  readonly timezone?: string;
  readonly includeCancelled?: boolean;
  readonly productId?: string;
}

/**
 * Export events to iCalendar (RFC 5545) format.
 * Returns a string in .ics format that can be used for Outlook, Apple Calendar, etc.
 */
export function exportToICal(
  events: readonly ScheduledEvent[],
  options: ICalExportOptions = {}
): string {
  // `timezone` here is the event-set's local tz — callers should pass
  // `tenant.defaultTimezone` (resolve via `getRegionConfig(tenant.countryCode).defaultTimezone`).
  // UTC is the neutral fallback when unspecified; do not hardcode a country tz.
  const {
    timezone = 'UTC',
    includeCancelled = false,
    productId = '-//Borjie//Scheduling//EN',
  } = options;

  const filtered = includeCancelled
    ? events
    : events.filter((e) => e.status !== 'cancelled');

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${productId}`,
    'CALSCALE:GREGORIAN',
    `X-WR-TIMEZONE:${timezone}`,
  ];

  for (const event of filtered) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${event.id}@borjie`);
    lines.push(`DTSTAMP:${formatICalDateUtc(new Date())}`);
    lines.push(`DTSTART;TZID=${timezone}:${formatICalDateLocal(event.startTime)}`);
    lines.push(`DTEND;TZID=${timezone}:${formatICalDateLocal(event.endTime)}`);
    lines.push(`SUMMARY:${escapeICalText(event.title)}`);

    if (event.description) {
      lines.push(`DESCRIPTION:${escapeICalText(event.description)}`);
    }

    if (event.location) {
      lines.push(`LOCATION:${escapeICalText(event.location)}`);
    }

    lines.push(`STATUS:${event.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`);

    for (const participant of event.participants) {
      if (participant.email) {
        lines.push(`ATTENDEE;CN=${escapeICalText(participant.name)}:mailto:${participant.email}`);
      }
    }

    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  return lines.join('\r\n');
}

/** Format date for iCal DTSTAMP (UTC) */
function formatICalDateUtc(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z';
}

/** Format date for iCal DTSTART/DTEND with TZID (local time) */
function formatICalDateLocal(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().slice(0, 19).replace(/[-:]/g, '');
}

/** Escape special characters for iCal text values */
function escapeICalText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/** iCal export interface - for dependency injection */
export interface ICalExporter {
  export(
    events: readonly ScheduledEvent[],
    options?: ICalExportOptions
  ): string;
}

/** Default iCal exporter implementation */
export const defaultICalExporter: ICalExporter = {
  export: exportToICal,
};
