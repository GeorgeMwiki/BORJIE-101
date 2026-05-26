/**
 * Calendar events repository (in-memory default).
 *
 * Dedup mirrors the SQL UNIQUE(tenant_id, provider, account,
 * calendar_id, event_id).
 */

import type { CalendarEvent, CalendarProvider } from '../types.js';

export interface CalendarEventsRepository {
  readonly put: (event: CalendarEvent) => Promise<{ inserted: boolean }>;
  readonly findByDedupKey: (key: {
    readonly tenantId: string;
    readonly provider: CalendarProvider;
    readonly account: string;
    readonly calendarId: string;
    readonly eventId: string;
  }) => Promise<CalendarEvent | null>;
  readonly listByTenant: (tenantId: string) => Promise<ReadonlyArray<CalendarEvent>>;
}

export function createInMemoryCalendarEventsRepository(): CalendarEventsRepository {
  const store = new Map<string, CalendarEvent>();
  const dedupKey = (m: {
    tenantId: string;
    provider: CalendarProvider;
    account: string;
    calendarId: string;
    eventId: string;
  }): string =>
    `${m.tenantId}::${m.provider}::${m.account}::${m.calendarId}::${m.eventId}`;

  return {
    put: async (event) => {
      const key = dedupKey({
        tenantId: event.tenant_id,
        provider: event.provider,
        account: event.account,
        calendarId: event.calendar_id,
        eventId: event.event_id,
      });
      if (store.has(key)) return { inserted: false };
      store.set(key, event);
      return { inserted: true };
    },
    findByDedupKey: async (key) => store.get(dedupKey(key)) ?? null,
    listByTenant: async (tenantId) =>
      Array.from(store.values()).filter((m) => m.tenant_id === tenantId),
  };
}
