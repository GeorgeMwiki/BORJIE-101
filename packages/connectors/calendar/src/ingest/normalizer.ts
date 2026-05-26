/**
 * Calendar normaliser — provider payload → canonical row.
 *
 * Recurring instances: the canonical `event_id` is the provider id
 * combined with `originalStartTime` (Google) or `seriesMasterId`
 * (Outlook) so the SQL UNIQUE stays stable across edits.
 */

import type {
  CalendarEvent,
  Clock,
  GoogleApiEvent,
  OutlookApiEvent,
  UuidGen,
} from '../types.js';
import type { PiiRedactor } from '../redact/pii-redactor.js';

export interface CalendarNormaliserDeps {
  readonly redactor: PiiRedactor;
  readonly clock: Clock;
  readonly uuid: UuidGen;
}

export interface NormaliseGoogleRequest {
  readonly tenantId: string;
  readonly account: string;
  readonly calendarId: string;
  readonly event: GoogleApiEvent;
  readonly auditHash: string;
}

export interface NormaliseOutlookRequest {
  readonly tenantId: string;
  readonly account: string;
  readonly calendarId: string;
  readonly event: OutlookApiEvent;
  readonly auditHash: string;
}

export function createCalendarNormaliser(deps: CalendarNormaliserDeps) {
  return {
    normaliseGoogle: async (
      req: NormaliseGoogleRequest,
    ): Promise<CalendarEvent> => {
      const fieldBase = `google_calendar:${req.account}:${req.calendarId}`;
      const summary =
        req.event.summary === undefined
          ? null
          : (await deps.redactor.redact({
              tenantId: req.tenantId,
              fieldId: `${fieldBase}:summary`,
              value: req.event.summary,
            })).redacted;
      const description =
        req.event.description === undefined
          ? null
          : (await deps.redactor.redact({
              tenantId: req.tenantId,
              fieldId: `${fieldBase}:description`,
              value: req.event.description,
            })).redacted;

      const attendees = await Promise.all(
        (req.event.attendees ?? []).map(async (a) => ({
          email_hash: await deps.redactor.redactAddress({
            tenantId: req.tenantId,
            fieldId: `${fieldBase}:attendee`,
            address: a.email,
          }),
          response_status: a.responseStatus ?? null,
        })),
      );

      // Recurring-instance stability: bake originalStartTime into the event_id.
      const ridSuffix =
        req.event.originalStartTime?.dateTime !== undefined
          ? `@${req.event.originalStartTime.dateTime}`
          : '';
      const eventId = `${req.event.id}${ridSuffix}`;

      return {
        id: deps.uuid.v4(),
        tenant_id: req.tenantId,
        provider: 'google_calendar',
        account: req.account,
        calendar_id: req.calendarId,
        event_id: eventId,
        summary,
        description,
        start_at: req.event.start.dateTime ?? req.event.start.date ?? null,
        end_at: req.event.end.dateTime ?? req.event.end.date ?? null,
        attendees,
        raw: {
          status: req.event.status,
          ...(req.event.location !== undefined
            ? { location: req.event.location }
            : {}),
        },
        ingested_at: deps.clock.nowIso(),
        audit_hash: req.auditHash,
      };
    },
    normaliseOutlook: async (
      req: NormaliseOutlookRequest,
    ): Promise<CalendarEvent> => {
      const fieldBase = `outlook_calendar:${req.account}:${req.calendarId}`;
      const summaryRedacted = (await deps.redactor.redact({
        tenantId: req.tenantId,
        fieldId: `${fieldBase}:summary`,
        value: req.event.subject,
      })).redacted;
      const descriptionRedacted = (await deps.redactor.redact({
        tenantId: req.tenantId,
        fieldId: `${fieldBase}:description`,
        value: req.event.bodyPreview,
      })).redacted;

      const attendees = await Promise.all(
        req.event.attendees.map(async (a) => ({
          email_hash: await deps.redactor.redactAddress({
            tenantId: req.tenantId,
            fieldId: `${fieldBase}:attendee`,
            address: a.emailAddress.address,
          }),
          response_status: a.status?.response ?? null,
        })),
      );

      const eventId =
        req.event.seriesMasterId !== undefined
          ? `${req.event.id}@${req.event.start.dateTime}`
          : req.event.id;

      return {
        id: deps.uuid.v4(),
        tenant_id: req.tenantId,
        provider: 'outlook_calendar',
        account: req.account,
        calendar_id: req.calendarId,
        event_id: eventId,
        summary: summaryRedacted,
        description: descriptionRedacted,
        start_at: req.event.start.dateTime,
        end_at: req.event.end.dateTime,
        attendees,
        raw: {
          ...(req.event.location !== undefined
            ? { location: req.event.location.displayName }
            : {}),
          startTimeZone: req.event.start.timeZone,
          endTimeZone: req.event.end.timeZone,
        },
        ingested_at: deps.clock.nowIso(),
        audit_hash: req.auditHash,
      };
    },
  };
}

export type CalendarNormaliser = ReturnType<typeof createCalendarNormaliser>;
