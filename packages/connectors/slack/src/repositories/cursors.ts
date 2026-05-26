/**
 * Slack ingest-cursor repository.
 *
 * Mirrors the `connector_cursors` table — opaque text cursor scoped
 * to `(tenant_id, connector_kind, connector_account)`. The Slack
 * connector stores the `latest` ts so backfill can resume.
 */

export interface CursorKey {
  readonly tenantId: string;
  readonly connectorAccount: string;
}

export interface CursorRepository {
  readonly get: (key: CursorKey) => Promise<string | null>;
  readonly put: (key: CursorKey, cursor: string | null) => Promise<void>;
}

export function createInMemoryCursorRepository(): CursorRepository {
  const store = new Map<string, string | null>();
  const k = (key: CursorKey): string => `${key.tenantId}::${key.connectorAccount}`;

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
