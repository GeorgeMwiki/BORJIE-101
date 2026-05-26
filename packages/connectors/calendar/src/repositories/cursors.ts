/**
 * Calendar cursor repository (in-memory default).
 */

import type { CalendarProvider } from '../types.js';

export interface CursorKey {
  readonly tenantId: string;
  readonly provider: CalendarProvider;
  readonly account: string;
  readonly calendarId: string;
}

export interface CursorRepository {
  readonly get: (key: CursorKey) => Promise<string | null>;
  readonly put: (key: CursorKey, cursor: string | null) => Promise<void>;
}

export function createInMemoryCursorRepository(): CursorRepository {
  const store = new Map<string, string | null>();
  const k = (key: CursorKey): string =>
    `${key.tenantId}::${key.provider}::${key.account}::${key.calendarId}`;

  return {
    get: async (key) => {
      const value = store.get(k(key));
      return value ?? null;
    },
    put: async (key, cursor) => {
      store.set(k(key), cursor);
    },
  };
}
