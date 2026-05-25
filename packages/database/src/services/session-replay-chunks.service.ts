/**
 * Session replay chunks service — Central Command Phase B (B5).
 *
 * Drizzle-backed write/read surface for `session_replay_chunks`
 * (migration 0142). One row per uploaded rrweb chunk; the gzip-
 * compressed, PII-masked event blob lives in the cold object store
 * (see `services/api-gateway/src/storage/session-replay-storage.ts`).
 *
 * Operations:
 *   - appendChunk(input)        — insert one chunk metadata row. Dedup
 *                                 on (session_id, sequence_number) so
 *                                 retried uploads are idempotent.
 *   - listForSession(args)      — ordered-oldest-first read of every
 *                                 chunk for a single (tenantId,
 *                                 sessionId) tuple. Capped at 5000
 *                                 chunks so the replay viewer cannot
 *                                 OOM the gateway.
 *   - listRecentSessions(args)  — distinct sessions for a tenant in a
 *                                 rolling window (powers the "all
 *                                 sessions" landing page in the
 *                                 admin viewer).
 *
 * Side-channel safety: hard DB errors are logged and the operation
 * surfaces a typed failure (`{ ok: false, reason: 'db-error' }`) so
 * the gateway can return a 503 to a degraded client without crashing.
 * The session-replay pipeline must never break the chat surface.
 */

import { randomUUID } from 'crypto';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { sessionReplayChunks } from '../schemas/session-replay-chunks.schema.js';
import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';


export interface SessionReplayChunkInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly surface: string;
  readonly sequenceNumber: number;
  readonly eventCount: number;
  readonly byteSize: number;
  readonly storageUri: string;
  readonly capturedAt: string;
}

export interface SessionReplayChunkRow {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly surface: string;
  readonly sequenceNumber: number;
  readonly eventCount: number;
  readonly byteSize: number;
  readonly storageUri: string;
  readonly capturedAt: string;
  readonly receivedAt: string;
}

export interface AppendChunkResult {
  readonly ok: boolean;
  readonly chunkId: string | null;
  /** `'inserted'` on success, `'duplicate'` when (session, seq) clashed,
   *  `'db-error'` on DB failure, `'invalid'` on caller-side data errors. */
  readonly reason: 'inserted' | 'duplicate' | 'db-error' | 'invalid';
}

export interface ListForSessionArgs {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly limit?: number;
}

export interface ListRecentSessionsArgs {
  readonly tenantId: string;
  /** Rolling window in minutes. Default 60 * 24 (one day). */
  readonly windowMinutes?: number;
  readonly limit?: number;
}

export interface RecentSessionSummary {
  readonly sessionId: string;
  readonly userId: string;
  readonly surface: string;
  readonly firstCapturedAt: string;
  readonly lastCapturedAt: string;
  readonly chunkCount: number;
}

export interface SessionReplayChunksService {
  appendChunk(input: SessionReplayChunkInput): Promise<AppendChunkResult>;
  listForSession(
    args: ListForSessionArgs,
  ): Promise<ReadonlyArray<SessionReplayChunkRow>>;
  listRecentSessions(
    args: ListRecentSessionsArgs,
  ): Promise<ReadonlyArray<RecentSessionSummary>>;
}

const DEFAULT_CHUNK_LIMIT = 1000;
const MAX_CHUNK_LIMIT = 5000;
const DEFAULT_SESSION_LIMIT = 100;
const MAX_SESSION_LIMIT = 500;
const DEFAULT_SESSION_WINDOW_MIN = 60 * 24;

export function createSessionReplayChunksService(
  db: DatabaseClient,
): SessionReplayChunksService {
  return {
    async appendChunk(input) {
      const validation = validateInput(input);
      if (!validation.ok) {
        return { ok: false, chunkId: null, reason: 'invalid' };
      }
      const capturedAt = parseTimestamp(input.capturedAt);
      if (!capturedAt) {
        return { ok: false, chunkId: null, reason: 'invalid' };
      }
      const id = randomUUID();
      try {
        await db.insert(sessionReplayChunks).values({
          id,
          tenantId: input.tenantId,
          userId: input.userId,
          sessionId: input.sessionId,
          surface: input.surface.slice(0, 64),
          sequenceNumber: input.sequenceNumber,
          eventCount: Math.max(0, Math.floor(input.eventCount)),
          byteSize: Math.max(0, Math.floor(input.byteSize)),
          storageUri: input.storageUri.slice(0, 2048),
          capturedAt,
        } as never);
        return { ok: true, chunkId: id, reason: 'inserted' };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isUniqueViolation(message)) {
          return { ok: false, chunkId: null, reason: 'duplicate' };
        }
        logger.error('session-replay-chunks.appendChunk failed', { error: error });
        return { ok: false, chunkId: null, reason: 'db-error' };
      }
    },

    async listForSession(args) {
      try {
        if (!args.tenantId || !args.sessionId) return [];
        const limit = clamp(
          args.limit,
          DEFAULT_CHUNK_LIMIT,
          1,
          MAX_CHUNK_LIMIT,
        );
        const rows = (await db
          .select(SELECT_COLS)
          .from(sessionReplayChunks)
          .where(
            and(
              eq(sessionReplayChunks.tenantId, args.tenantId),
              eq(sessionReplayChunks.sessionId, args.sessionId),
            ),
          )
          .orderBy(asc(sessionReplayChunks.sequenceNumber))
          .limit(limit)) as ReadonlyArray<RawRow>;
        return (rows ?? []).map(rowToEntry);
      } catch (error) {
        logger.error('session-replay-chunks.listForSession failed', { error: error });
        return [];
      }
    },

    async listRecentSessions(args) {
      try {
        if (!args.tenantId) return [];
        const windowMin = clamp(
          args.windowMinutes,
          DEFAULT_SESSION_WINDOW_MIN,
          1,
          60 * 24 * 30,
        );
        const limit = clamp(
          args.limit,
          DEFAULT_SESSION_LIMIT,
          1,
          MAX_SESSION_LIMIT,
        );
        const cutoff = new Date(Date.now() - windowMin * 60 * 1000);
        const rows = (await db
          .select({
            sessionId: sessionReplayChunks.sessionId,
            userId: sessionReplayChunks.userId,
            surface: sessionReplayChunks.surface,
            firstCapturedAt: sql<Date>`min(${sessionReplayChunks.capturedAt})`,
            lastCapturedAt: sql<Date>`max(${sessionReplayChunks.capturedAt})`,
            chunkCount: sql<number>`count(*)::int`,
          })
          .from(sessionReplayChunks)
          .where(
            and(
              eq(sessionReplayChunks.tenantId, args.tenantId),
              gte(sessionReplayChunks.capturedAt, cutoff),
            ),
          )
          .groupBy(
            sessionReplayChunks.sessionId,
            sessionReplayChunks.userId,
            sessionReplayChunks.surface,
          )
          .orderBy(desc(sql<Date>`max(${sessionReplayChunks.capturedAt})`))
          .limit(limit)) as ReadonlyArray<RecentSessionRawRow>;
        return (rows ?? []).map((r) => ({
          sessionId: r.sessionId,
          userId: r.userId,
          surface: r.surface,
          firstCapturedAt: toIso(r.firstCapturedAt),
          lastCapturedAt: toIso(r.lastCapturedAt),
          chunkCount: Number(r.chunkCount) || 0,
        }));
      } catch (error) {
        logger.error('session-replay-chunks.listRecentSessions failed', { error: error });
        return [];
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const SELECT_COLS = {
  id: sessionReplayChunks.id,
  tenantId: sessionReplayChunks.tenantId,
  userId: sessionReplayChunks.userId,
  sessionId: sessionReplayChunks.sessionId,
  surface: sessionReplayChunks.surface,
  sequenceNumber: sessionReplayChunks.sequenceNumber,
  eventCount: sessionReplayChunks.eventCount,
  byteSize: sessionReplayChunks.byteSize,
  storageUri: sessionReplayChunks.storageUri,
  capturedAt: sessionReplayChunks.capturedAt,
  receivedAt: sessionReplayChunks.receivedAt,
} as const;

interface RawRow {
  id: string;
  tenantId: string;
  userId: string;
  sessionId: string;
  surface: string;
  sequenceNumber: number;
  eventCount: number;
  byteSize: number;
  storageUri: string;
  capturedAt: Date | string;
  receivedAt: Date | string;
}

interface RecentSessionRawRow {
  sessionId: string;
  userId: string;
  surface: string;
  firstCapturedAt: Date | string;
  lastCapturedAt: Date | string;
  chunkCount: number | string;
}

function rowToEntry(row: RawRow): SessionReplayChunkRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    sessionId: row.sessionId,
    surface: row.surface,
    sequenceNumber: Number(row.sequenceNumber) || 0,
    eventCount: Number(row.eventCount) || 0,
    byteSize: Number(row.byteSize) || 0,
    storageUri: row.storageUri,
    capturedAt: toIso(row.capturedAt),
    receivedAt: toIso(row.receivedAt),
  };
}

function toIso(v: Date | string): string {
  if (v instanceof Date) return v.toISOString();
  return new Date(v).toISOString();
}

function parseTimestamp(v: string): Date | null {
  if (!v || typeof v !== 'string') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function clamp(
  v: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) return fallback;
  return Math.min(max, Math.floor(v));
}

function validateInput(input: SessionReplayChunkInput): { ok: boolean } {
  if (!input || typeof input !== 'object') return { ok: false };
  if (!input.tenantId || !input.userId || !input.sessionId) {
    return { ok: false };
  }
  if (!input.surface || !input.storageUri) return { ok: false };
  if (
    typeof input.sequenceNumber !== 'number' ||
    !Number.isFinite(input.sequenceNumber) ||
    input.sequenceNumber < 0
  ) {
    return { ok: false };
  }
  return { ok: true };
}

/** Postgres unique-violation tells us we hit the dedup index. The
 *  Drizzle wrapper does not always wrap pg's SQLSTATE; matching on
 *  the message keeps the test stubs simple AND the prod path works. */
function isUniqueViolation(message: string): boolean {
  const msg = (message || '').toLowerCase();
  return (
    msg.includes('duplicate key') ||
    msg.includes('unique constraint') ||
    msg.includes('idx_session_replay_chunks_session_seq')
  );
}
