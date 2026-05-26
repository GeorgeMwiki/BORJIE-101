/**
 * In-memory Voice calls repository.
 */

import type { VoiceCallPayload } from '../types.js';

export interface VoiceCallRow {
  readonly id: string;
  readonly tenantId: string;
  /** Twilio sub-account SID. */
  readonly twilioAccount: string;
  readonly callSid: string;
  readonly payload: VoiceCallPayload;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly ingestedAt: string;
  readonly auditHash: string;
}

export interface VoiceCallRepository {
  readonly upsert: (row: VoiceCallRow) => Promise<VoiceCallRow>;
  readonly findByKey: (params: {
    readonly tenantId: string;
    readonly twilioAccount: string;
    readonly callSid: string;
  }) => Promise<VoiceCallRow | null>;
  readonly all: () => Promise<ReadonlyArray<VoiceCallRow>>;
}

export function createInMemoryVoiceRepository(): VoiceCallRepository {
  const byKey = new Map<string, VoiceCallRow>();
  const k = (t: string, a: string, c: string) => `${t}|${a}|${c}`;
  return {
    async upsert(row) {
      const existing = byKey.get(k(row.tenantId, row.twilioAccount, row.callSid));
      if (existing && existing.payload.startedAt >= row.payload.startedAt) return existing;
      byKey.set(k(row.tenantId, row.twilioAccount, row.callSid), row);
      return row;
    },
    async findByKey(p) {
      return byKey.get(k(p.tenantId, p.twilioAccount, p.callSid)) ?? null;
    },
    async all() {
      return Array.from(byKey.values());
    },
  };
}
