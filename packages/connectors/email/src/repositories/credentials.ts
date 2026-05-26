/**
 * Email credentials repository (in-memory default).
 *
 * The repository NEVER sees plaintext tokens — callers seal via the
 * injected `CredentialCipher` before invoking `put`.
 */

import type { EmailProvider, StoredEmailCredentials } from '../types.js';

export interface EmailCredentialsRepository {
  readonly put: (creds: StoredEmailCredentials) => Promise<void>;
  readonly get: (key: {
    readonly tenantId: string;
    readonly provider: EmailProvider;
    readonly account: string;
  }) => Promise<StoredEmailCredentials | null>;
  readonly delete: (key: {
    readonly tenantId: string;
    readonly provider: EmailProvider;
    readonly account: string;
  }) => Promise<void>;
}

export function createInMemoryEmailCredentialsRepository(): EmailCredentialsRepository {
  const store = new Map<string, StoredEmailCredentials>();
  const k = (key: { tenantId: string; provider: EmailProvider; account: string }): string =>
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
