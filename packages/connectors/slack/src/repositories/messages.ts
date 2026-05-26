/**
 * Slack messages repository.
 *
 * Two implementations live behind the same port:
 *   - in-memory (test default)
 *   - sql-port  (sketch — wires onto the `slack_messages` table at
 *     boot via the host's @borjie/database client)
 *
 * Dedup mirrors the SQL `UNIQUE(tenant_id, workspace_id, channel_id,
 * ts)`: `put` is a no-op if a row with the same dedup key exists.
 */

import type { SlackMessage } from '../types.js';

export interface SlackMessagesRepository {
  readonly put: (msg: SlackMessage) => Promise<{ inserted: boolean }>;
  readonly findByDedupKey: (key: {
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly channelId: string;
    readonly ts: string;
  }) => Promise<SlackMessage | null>;
  readonly listByTenant: (tenantId: string) => Promise<ReadonlyArray<SlackMessage>>;
}

export function createInMemorySlackMessagesRepository(): SlackMessagesRepository {
  // Map<dedup-key, SlackMessage>
  const store = new Map<string, SlackMessage>();

  const dedupKey = (m: {
    tenantId: string;
    workspaceId: string;
    channelId: string;
    ts: string;
  }): string => `${m.tenantId}::${m.workspaceId}::${m.channelId}::${m.ts}`;

  return {
    put: async (msg) => {
      const key = dedupKey({
        tenantId: msg.tenant_id,
        workspaceId: msg.workspace_id,
        channelId: msg.channel_id,
        ts: msg.ts,
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
