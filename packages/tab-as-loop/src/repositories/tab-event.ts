/**
 * In-memory `TabEventRepository` + a SQL contract stub.
 *
 * Wave M5. Pure-memory adapter for tests. The database package wires
 * the real Drizzle adapter against `tab_events` from migration 0036.
 *
 * Per-session events are stored in iteration-sorted order; the query
 * `listForSession` filters by tenant + session + iteration cursor.
 */

import type { TabEvent, TabEventRepository } from '../types.js';

export function createInMemoryTabEventRepository(): TabEventRepository {
  // Sessions → ordered event list. Iteration order is preserved on
  // insert; we sort on read to defend against out-of-order writes.
  const rows = new Map<string, TabEvent[]>();

  return {
    async append(event: TabEvent): Promise<TabEvent> {
      const list = rows.get(event.tabSessionId) ?? [];
      list.push(Object.freeze({ ...event }));
      list.sort((a, b) => a.iteration - b.iteration);
      rows.set(event.tabSessionId, list);
      return event;
    },

    async listForSession(
      tenantId: string,
      sessionId: string,
      fromIterationExclusive: number,
    ): Promise<ReadonlyArray<TabEvent>> {
      const list = rows.get(sessionId) ?? [];
      const matches: TabEvent[] = [];
      for (const event of list) {
        if (
          event.tenantId === tenantId &&
          event.iteration > fromIterationExclusive
        ) {
          matches.push(event);
        }
      }
      return matches;
    },
  };
}
