/**
 * Session replay chunks — Central Command Phase B (B5 — Session Replay
 * + Counter-Model Safety).
 *
 * Drizzle schema for `session_replay_chunks` (migration 0142). One row
 * per uploaded rrweb chunk. The gzip-compressed, PII-masked event blob
 * lives in the cold object store (S3 in prod, local FS in dev),
 * addressed by `storage_uri`.
 *
 * IMPORTANT — this table is the INDEX for cold replay. The replay
 * event stream is held SEPARATELY from the 14-event sensorium analytics
 * taxonomy. Mouse-move at ≈20Hz lives here; it is NEVER fed into the
 * LLM context window (per PostHog's session-replay-vs-analytics
 * separation — see `.planning/research/central-command/2025-brain-as-
 * os.md`).
 *
 * Dedup key: UNIQUE(session_id, sequence_number) — retries from a
 * flaky client must not insert duplicate rows.
 */

import {
  pgTable,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const sessionReplayChunks = pgTable(
  'session_replay_chunks',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    sessionId: text('session_id').notNull(),
    surface: text('surface').notNull(),
    /** Monotonic per-session sequence allocated by the client. */
    sequenceNumber: integer('sequence_number').notNull(),
    /** rrweb event count carried by the chunk. */
    eventCount: integer('event_count').notNull().default(0),
    /** Gzip payload size in bytes (informational; surfaced to viewer). */
    byteSize: integer('byte_size').notNull().default(0),
    /** Cold-store pointer: `file://...` in dev, `s3://...` in prod. */
    storageUri: text('storage_uri').notNull(),
    /** Client-side timestamp (chunk capture window end). */
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    /** Server-side timestamp (gateway accepted the upload). */
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    sessionSeqUx: uniqueIndex('idx_session_replay_chunks_session_seq').on(
      t.sessionId,
      t.sequenceNumber,
    ),
    tenantSessionIdx: index('idx_session_replay_chunks_tenant_session').on(
      t.tenantId,
      t.sessionId,
      t.capturedAt,
    ),
    tenantUserTimeIdx: index(
      'idx_session_replay_chunks_tenant_user_time',
    ).on(t.tenantId, t.userId, t.capturedAt.desc()),
  }),
);

export type SessionReplayChunkRow = typeof sessionReplayChunks.$inferSelect;
export type NewSessionReplayChunkRow =
  typeof sessionReplayChunks.$inferInsert;
