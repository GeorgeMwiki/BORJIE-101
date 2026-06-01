/**
 * Shared types for the `calendar` delivery channel.
 *
 * A CalendarEventProvider takes a normalized event (derived from a reminder or
 * an autonomous-worker time-bound item) plus a valid access token, and upserts
 * a real calendar event idempotently on a STABLE external id (the source row's
 * id). Re-running with the same `sourceId` patches the existing event instead
 * of creating a duplicate — the core guarantee under at-least-once dispatch.
 */

import type { CalendarProvider } from '@borjie/database/schemas';

/** A normalized event to materialise in the owner's calendar. */
export interface CalendarEventInput {
  /**
   * STABLE idempotency key — the reminder id or the autonomous item id. The
   * provider derives the upstream event identity from this so a retry patches
   * rather than duplicates.
   */
  readonly sourceId: string;
  readonly summary: string;
  readonly description: string;
  /** Event start (ISO-8601). */
  readonly startIso: string;
  /** Event end (ISO-8601). When absent the provider uses start + 30 min. */
  readonly endIso?: string;
  /** IANA timezone (e.g. 'Africa/Dar_es_Salaam'). Defaults to 'UTC'. */
  readonly timeZone?: string;
  /** Target calendar id ('primary' for Google / MS default). */
  readonly calendarId: string;
}

export type CalendarUpsertResult =
  | {
      readonly status: 'created' | 'updated';
      readonly provider: CalendarProvider;
      /** Upstream event id (provider-assigned or our deterministic id). */
      readonly eventId: string;
    }
  | {
      readonly status: 'failed';
      readonly provider: CalendarProvider;
      readonly errorCode: string;
      readonly errorMessage: string;
      readonly retryable: boolean;
    };

export interface CalendarEventProvider {
  readonly provider: CalendarProvider;
  /**
   * Upsert (create-or-update) the event idempotently. MUST NOT create a second
   * event when called twice with the same `input.sourceId`.
   */
  upsertEvent(
    accessToken: string,
    input: CalendarEventInput,
  ): Promise<CalendarUpsertResult>;
}

/** HTTP seam so providers are unit-testable without real network calls. */
export type CalendarFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface CalendarProviderDeps {
  readonly fetcher?: CalendarFetcher;
}
