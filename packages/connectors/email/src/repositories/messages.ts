/**
 * Email messages repository (in-memory default).
 */

import type { EmailMessage, EmailProvider } from '../types.js';

export interface EmailMessagesRepository {
  readonly put: (msg: EmailMessage) => Promise<{ inserted: boolean }>;
  readonly findByDedupKey: (key: {
    readonly tenantId: string;
    readonly provider: EmailProvider;
    readonly account: string;
    readonly messageId: string;
  }) => Promise<EmailMessage | null>;
  readonly listByTenant: (tenantId: string) => Promise<ReadonlyArray<EmailMessage>>;
}

export function createInMemoryEmailMessagesRepository(): EmailMessagesRepository {
  const store = new Map<string, EmailMessage>();
  const dedupKey = (m: {
    tenantId: string;
    provider: EmailProvider;
    account: string;
    messageId: string;
  }): string => `${m.tenantId}::${m.provider}::${m.account}::${m.messageId}`;

  return {
    put: async (msg) => {
      const key = dedupKey({
        tenantId: msg.tenant_id,
        provider: msg.provider,
        account: msg.account,
        messageId: msg.message_id,
      });
      if (store.has(key)) return { inserted: false };
      store.set(key, msg);
      return { inserted: true };
    },
    findByDedupKey: async (key) => store.get(dedupKey(key)) ?? null,
    listByTenant: async (tenantId) =>
      Array.from(store.values()).filter((m) => m.tenant_id === tenantId),
  };
}
