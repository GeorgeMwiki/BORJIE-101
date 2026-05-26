/**
 * In-memory Zoom meetings repository.
 */

import type { ZoomMeetingPayload } from '../types.js';

export interface ZoomMeetingRow {
  readonly id: string;
  readonly tenantId: string;
  readonly account: string;
  readonly meetingId: string;
  readonly payload: ZoomMeetingPayload;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly ingestedAt: string;
  readonly auditHash: string;
}

export interface ZoomMeetingRepository {
  readonly upsert: (row: ZoomMeetingRow) => Promise<ZoomMeetingRow>;
  readonly findByKey: (params: {
    readonly tenantId: string;
    readonly account: string;
    readonly meetingId: string;
  }) => Promise<ZoomMeetingRow | null>;
  readonly all: () => Promise<ReadonlyArray<ZoomMeetingRow>>;
}

export function createInMemoryZoomRepository(): ZoomMeetingRepository {
  const byKey = new Map<string, ZoomMeetingRow>();
  const k = (t: string, a: string, m: string) => `${t}|${a}|${m}`;
  return {
    async upsert(row) {
      const existing = byKey.get(k(row.tenantId, row.account, row.meetingId));
      if (existing && existing.payload.startAt >= row.payload.startAt) return existing;
      byKey.set(k(row.tenantId, row.account, row.meetingId), row);
      return row;
    },
    async findByKey(p) {
      return byKey.get(k(p.tenantId, p.account, p.meetingId)) ?? null;
    },
    async all() {
      return Array.from(byKey.values());
    },
  };
}
