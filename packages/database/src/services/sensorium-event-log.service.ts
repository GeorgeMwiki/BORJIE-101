/**
 * Sensorium event-log service — Central Command Phase A (C4).
 *
 * Drizzle-backed write/read surface for `sensorium_event_log` (migration
 * 0132). One row per filtered sensory event accepted by the api-gateway
 * sensorium router.
 *
 * Operations:
 *   - appendBatch(rows)        : insert N rows in a single statement.
 *                                Returns the count actually inserted.
 *                                Hard DB failure ⇒ logs + returns 0
 *                                (the sensorium channel is a side
 *                                channel; it must never break the chat).
 *   - listForSession(args)     : ordered-newest-first read for a single
 *                                (tenant, user, session) window. Capped
 *                                at 500 rows so the BehaviorObserver
 *                                aggregator cannot OOM the kernel.
 *   - countByTypeForUser(args) : cheap event-type histogram over a
 *                                rolling window — feeds the
 *                                engagement.high / frustration.detected
 *                                signal derivation.
 *
 * Mouse-move events are filtered at the client (never persisted). Any
 * caller that sneaks one through is dropped here as a defence-in-depth
 * guard — see {@link SENSORIUM_EVENT_TYPES}.
 */

import { randomUUID } from 'crypto';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import {

  SENSORIUM_EVENT_TYPES,
  sensoriumEventLog,
  type SensoriumEventType,
} from '../schemas/sensorium-event-log.schema.js';
import { logger } from '../logger.js';
import type { DatabaseClient } from '../client.js';

const VALID_EVENT_TYPES: ReadonlySet<string> = new Set(SENSORIUM_EVENT_TYPES);

export interface SensoriumEventInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly surface: string;
  readonly route: string;
  readonly eventType: SensoriumEventType;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly emittedAt: string;
}

export interface SensoriumEventRow {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly surface: string;
  readonly route: string;
  readonly eventType: SensoriumEventType;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly emittedAt: string;
  readonly receivedAt: string;
}

export interface ListForSessionArgs {
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
  /** Optional cap — clamped to [1, 500]. Default 200. */
  readonly limit?: number;
  /** Optional rolling window in minutes. Default 30. */
  readonly windowMinutes?: number;
}

export interface CountByTypeArgs {
  readonly tenantId: string;
  readonly userId: string;
  /** Optional rolling window in minutes. Default 15. */
  readonly windowMinutes?: number;
}

export interface SensoriumEventLogService {
  appendBatch(
    rows: ReadonlyArray<SensoriumEventInput>,
  ): Promise<{ readonly inserted: number; readonly rejected: number }>;
  listForSession(
    args: ListForSessionArgs,
  ): Promise<ReadonlyArray<SensoriumEventRow>>;
  countByTypeForUser(
    args: CountByTypeArgs,
  ): Promise<Readonly<Record<SensoriumEventType, number>>>;
}

const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 500;
const DEFAULT_LIST_WINDOW_MIN = 30;
const DEFAULT_COUNT_WINDOW_MIN = 15;

export function createSensoriumEventLogService(
  db: DatabaseClient,
): SensoriumEventLogService {
  return {
    async appendBatch(rows) {
      if (!Array.isArray(rows) || rows.length === 0) {
        return { inserted: 0, rejected: 0 };
      }
      const accepted: Array<Record<string, unknown>> = [];
      let rejected = 0;
      for (const r of rows) {
        if (!r || typeof r !== 'object') {
          rejected += 1;
          continue;
        }
        if (
          !r.tenantId ||
          !r.userId ||
          !r.sessionId ||
          !r.surface ||
          !r.route ||
          !r.eventType
        ) {
          rejected += 1;
          continue;
        }
        if (!VALID_EVENT_TYPES.has(r.eventType)) {
          rejected += 1;
          continue;
        }
        // Defence-in-depth: even if the client mis-filed, never persist
        // raw mouse coordinates or full input values. These get rejected
        // not redacted — the client is supposed to redact before send.
        const payload =
          r.payload && typeof r.payload === 'object' ? { ...r.payload } : {};
        if ('mouseX' in payload || 'mouseY' in payload || 'value' in payload) {
          rejected += 1;
          continue;
        }
        const emittedAt = parseTimestamp(r.emittedAt);
        if (!emittedAt) {
          rejected += 1;
          continue;
        }
        accepted.push({
          id: randomUUID(),
          tenantId: r.tenantId,
          userId: r.userId,
          sessionId: r.sessionId,
          surface: r.surface.slice(0, 64),
          route: r.route.slice(0, 512),
          eventType: r.eventType,
          payloadJson: payload,
          emittedAt,
        });
      }
      if (accepted.length === 0) return { inserted: 0, rejected };
      try {
        await db.insert(sensoriumEventLog).values(accepted as never);
        return { inserted: accepted.length, rejected };
      } catch (error) {
        logger.error('sensorium.appendBatch failed', { error: error });
        return { inserted: 0, rejected: rejected + accepted.length };
      }
    },

    async listForSession(args) {
      try {
        if (!args.tenantId || !args.userId || !args.sessionId) return [];
        const limit = clampLimit(args.limit, DEFAULT_LIST_LIMIT);
        const windowMin = clampWindow(
          args.windowMinutes,
          DEFAULT_LIST_WINDOW_MIN,
        );
        const cutoff = new Date(Date.now() - windowMin * 60 * 1000);
        const rows = (await db
          .select(SELECT_COLS)
          .from(sensoriumEventLog)
          .where(
            and(
              eq(sensoriumEventLog.tenantId, args.tenantId),
              eq(sensoriumEventLog.userId, args.userId),
              eq(sensoriumEventLog.sessionId, args.sessionId),
              gte(sensoriumEventLog.emittedAt, cutoff),
            ),
          )
          .orderBy(desc(sensoriumEventLog.emittedAt))
          .limit(limit)) as ReadonlyArray<RawRow>;
        return (rows ?? []).map(rowToEntry);
      } catch (error) {
        logger.error('sensorium.listForSession failed', { error: error });
        return [];
      }
    },

    async countByTypeForUser(args) {
      const empty = emptyHistogram();
      try {
        if (!args.tenantId || !args.userId) return empty;
        const windowMin = clampWindow(
          args.windowMinutes,
          DEFAULT_COUNT_WINDOW_MIN,
        );
        const cutoff = new Date(Date.now() - windowMin * 60 * 1000);
        const rows = (await db
          .select({
            eventType: sensoriumEventLog.eventType,
            n: sql<number>`count(*)::int`,
          })
          .from(sensoriumEventLog)
          .where(
            and(
              eq(sensoriumEventLog.tenantId, args.tenantId),
              eq(sensoriumEventLog.userId, args.userId),
              gte(sensoriumEventLog.emittedAt, cutoff),
            ),
          )
          .groupBy(sensoriumEventLog.eventType)) as ReadonlyArray<{
          eventType: string;
          n: number;
        }>;
        const out: Record<SensoriumEventType, number> = { ...empty };
        for (const row of rows ?? []) {
          if (VALID_EVENT_TYPES.has(row.eventType)) {
            out[row.eventType as SensoriumEventType] = Number(row.n) || 0;
          }
        }
        return out;
      } catch (error) {
        logger.error('sensorium.countByTypeForUser failed', { error: error });
        return empty;
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const SELECT_COLS = {
  id: sensoriumEventLog.id,
  tenantId: sensoriumEventLog.tenantId,
  userId: sensoriumEventLog.userId,
  sessionId: sensoriumEventLog.sessionId,
  surface: sensoriumEventLog.surface,
  route: sensoriumEventLog.route,
  eventType: sensoriumEventLog.eventType,
  payloadJson: sensoriumEventLog.payloadJson,
  emittedAt: sensoriumEventLog.emittedAt,
  receivedAt: sensoriumEventLog.receivedAt,
} as const;

interface RawRow {
  id: string;
  tenantId: string;
  userId: string;
  sessionId: string;
  surface: string;
  route: string;
  eventType: string;
  payloadJson: unknown;
  emittedAt: Date | string;
  receivedAt: Date | string;
}

function rowToEntry(row: RawRow): SensoriumEventRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    sessionId: row.sessionId,
    surface: row.surface,
    route: row.route,
    eventType: row.eventType as SensoriumEventType,
    payload:
      row.payloadJson && typeof row.payloadJson === 'object'
        ? (row.payloadJson as Record<string, unknown>)
        : {},
    emittedAt: toIso(row.emittedAt),
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

function clampLimit(v: number | undefined, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 1) return fallback;
  return Math.min(MAX_LIST_LIMIT, Math.floor(v));
}

function clampWindow(v: number | undefined, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 1) return fallback;
  return Math.min(24 * 60, Math.floor(v));
}

function emptyHistogram(): Record<SensoriumEventType, number> {
  const out = {} as Record<SensoriumEventType, number>;
  for (const t of SENSORIUM_EVENT_TYPES) out[t] = 0;
  return out;
}
