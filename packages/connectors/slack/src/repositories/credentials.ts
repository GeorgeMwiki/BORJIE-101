/**
 * Slack credentials repository.
 *
 * The repository NEVER sees plaintext tokens — callers seal via the
 * `CredentialCipher` boundary before invoking `put`. The `bytea`
 * columns in `connector_credentials` map to `Uint8Array` here.
 */

import type { StoredCredentials } from '../types.js';

export interface CredentialsRepository {
  readonly put: (creds: StoredCredentials) => Promise<void>;
  readonly get: (key: {
    readonly tenantId: string;
    readonly connectorAccount: string;
  }) => Promise<StoredCredentials | null>;
  readonly delete: (key: {
    readonly tenantId: string;
    readonly connectorAccount: string;
  }) => Promise<void>;
}

export function createInMemoryCredentialsRepository(): CredentialsRepository {
  const store = new Map<string, StoredCredentials>();

  const k = (key: { tenantId: string; connectorAccount: string }): string =>
    `${key.tenantId}::${key.connectorAccount}`;

  return {
    put: async (creds) => {
      store.set(
        k({
          tenantId: creds.tenant_id,
          connectorAccount: creds.connector_account,
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
