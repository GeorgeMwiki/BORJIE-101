/**
 * In-memory Teams messages repository.
 */

import type { TeamsMessagePayload } from '../types.js';

export interface TeamsMessageRow {
  readonly id: string;
  readonly tenantId: string;
  readonly account: string;
  readonly teamId: string;
  readonly channelId: string;
  readonly messageId: string;
  readonly payload: TeamsMessagePayload;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly ingestedAt: string;
  readonly auditHash: string;
}

export interface TeamsMessageRepository {
  readonly upsert: (row: TeamsMessageRow) => Promise<TeamsMessageRow>;
  readonly findByKey: (params: {
    readonly tenantId: string;
    readonly account: string;
    readonly teamId: string;
    readonly channelId: string;
    readonly messageId: string;
  }) => Promise<TeamsMessageRow | null>;
  readonly all: () => Promise<ReadonlyArray<TeamsMessageRow>>;
}

export function createInMemoryTeamsRepository(): TeamsMessageRepository {
  const byKey = new Map<string, TeamsMessageRow>();
  const k = (t: string, a: string, ti: string, ci: string, mi: string) =>
    `${t}|${a}|${ti}|${ci}|${mi}`;
  return {
    async upsert(row) {
      const existing = byKey.get(k(row.tenantId, row.account, row.teamId, row.channelId, row.messageId));
      if (existing && existing.payload.sentAt > row.payload.sentAt) return existing;
      byKey.set(k(row.tenantId, row.account, row.teamId, row.channelId, row.messageId), row);
      return row;
    },
    async findByKey(p) {
      return byKey.get(k(p.tenantId, p.account, p.teamId, p.channelId, p.messageId)) ?? null;
    },
    async all() {
      return Array.from(byKey.values());
    },
  };
}
