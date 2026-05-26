/**
 * Calendar credentials repository (in-memory default).
 */

import type { CalendarProvider, StoredCalendarCredentials } from '../types.js';

export interface CalendarCredentialsRepository {
  readonly put: (creds: StoredCalendarCredentials) => Promise<void>;
  readonly get: (key: {
    readonly tenantId: string;
    readonly provider: CalendarProvider;
    readonly account: string;
  }) => Promise<StoredCalendarCredentials | null>;
  readonly delete: (key: {
    readonly tenantId: string;
    readonly provider: CalendarProvider;
    readonly account: string;
  }) => Promise<void>;
}

export function createInMemoryCalendarCredentialsRepository(): CalendarCredentialsRepository {
  const store = new Map<string, StoredCalendarCredentials>();
  const k = (key: { tenantId: string; provider: CalendarProvider; account: string }): string =>
    `${key.tenantId}::${key.provider}::${key.account}`;

  return {
    put: async (creds) => {
      store.set(
        k({
          tenantId: creds.tenant_id,
          provider: creds.connector_kind,
          account: creds.connector_account,
        }),
        creds,
      );
    },
    get: async (key) => store.get(k(key)) ?? null,
    delete: async (key) => {
      store.delete(k(key));
    },
  };
}
