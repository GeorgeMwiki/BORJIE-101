/**
 * Reflexion buffer — Drizzle-backed service.
 *
 * Writes one row per kernel session-end verbal reflection. Reads the
 * last N reflections for a (tenant, user) pair so the kernel can
 * inject them into the system prompt at session start.
 *
 * Hard DB failures degrade gracefully — the kernel never breaks
 * because the reflexion store is unreachable.
 */

import { randomUUID } from 'crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { reflexionBuffer } from '../schemas/reflexion-buffer.schema.js';
import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';


export type ReflexionOutcome = 'success' | 'failure' | 'mixed';

export interface ReflexionEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly reflection: string;
  readonly outcome: ReflexionOutcome;
  readonly recordedAt: string;
  readonly retrievedCount: number;
}

export interface RecordReflexionArgs {
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly reflection: string;
  readonly outcome: ReflexionOutcome;
}

export interface RecallReflexionsArgs {
  readonly tenantId: string;
  readonly userId: string;
  /** Cap on rows. Default 3 (the Reflexion paper's sweet spot). */
  readonly limit?: number;
  /**
   * When true, the service `UPDATE`s `retrieved_count` for each
   * surfaced row so we can tell which reflections are actually being
   * used. Default true. Tests pass false to keep assertions stable.
   */
  readonly bumpTelemetry?: boolean;
}

export interface ReflexionBufferService {
  record(args: RecordReflexionArgs): Promise<{ id: string }>;
  recall(args: RecallReflexionsArgs): Promise<ReadonlyArray<ReflexionEntry>>;
}

const REFLECTION_MAX_LEN = 4_000;
const DEFAULT_RECALL_LIMIT = 3;
const MAX_RECALL_LIMIT = 25;
const VALID_OUTCOMES: ReadonlySet<ReflexionOutcome> = new Set([
  'success',
  'failure',
  'mixed',
]);

export function createReflexionBufferService(
  db: DatabaseClient,
): ReflexionBufferService {
  return {
    async record(args) {
      const id = randomUUID();
      try {
        if (!args.tenantId || !args.userId || !args.sessionId) {
          throw new Error(
            'tenantId / userId / sessionId are required for reflexion record',
          );
        }
        if (!VALID_OUTCOMES.has(args.outcome)) {
          throw new Error(`unknown reflexion outcome: ${args.outcome}`);
        }
        const reflection = (args.reflection ?? '').slice(0, REFLECTION_MAX_LEN);
        if (!reflection.trim()) {
          throw new Error('reflexion text must not be empty');
        }

        await db.insert(reflexionBuffer).values({
          id,
          tenantId: args.tenantId,
          userId: args.userId,
          sessionId: args.sessionId,
          reflection,
          outcome: args.outcome,
        } as never);

        return { id };
      } catch (error) {
        logger.error('reflexion-buffer.record failed', { error: error });
        return { id };
      }
    },

    async recall(args) {
      try {
        if (!args.tenantId || !args.userId) return [];
        const limit = clampLimit(args.limit, DEFAULT_RECALL_LIMIT);

        const rows = (await db
          .select(SELECT_COLS)
          .from(reflexionBuffer)
          .where(
            and(
              eq(reflexionBuffer.tenantId, args.tenantId),
              eq(reflexionBuffer.userId, args.userId),
            ),
          )
          .orderBy(desc(reflexionBuffer.recordedAt))
          .limit(limit)) as ReadonlyArray<ReflexionRow>;

        const entries = (rows ?? []).map(rowToEntry);

        if (args.bumpTelemetry !== false && entries.length > 0) {
          const ids = entries.map((e) => e.id);
          // Best-effort telemetry bump; failure here must NOT block the
          // recall response (the kernel still consumes the reflections).
          try {
            await db
              .update(reflexionBuffer)
              .set({
                retrievedCount: sql`${reflexionBuffer.retrievedCount} + 1`,
              } as never)
              .where(
                sql`${reflexionBuffer.id} = ANY(${sql.raw(`ARRAY[${ids.map((i) => `'${i.replace(/'/g, "''")}'`).join(',')}]`)}::text[])`,
              );
          } catch (error) {
            logger.warn('reflexion-buffer.recall telemetry-bump failed', { error });
          }
        }
        return entries;
      } catch (error) {
        logger.error('reflexion-buffer.recall failed', { error: error });
        return [];
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const SELECT_COLS = {
  id: reflexionBuffer.id,
  tenantId: reflexionBuffer.tenantId,
  userId: reflexionBuffer.userId,
  sessionId: reflexionBuffer.sessionId,
  reflection: reflexionBuffer.reflection,
  outcome: reflexionBuffer.outcome,
  recordedAt: reflexionBuffer.recordedAt,
  retrievedCount: reflexionBuffer.retrievedCount,
} as const;

interface ReflexionRow {
  id: string;
  tenantId: string;
  userId: string;
  sessionId: string;
  reflection: string;
  outcome: string;
  recordedAt: Date | string;
  retrievedCount: number;
}

function rowToEntry(row: ReflexionRow): ReflexionEntry {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    sessionId: row.sessionId,
    reflection: row.reflection,
    outcome: normaliseOutcome(row.outcome),
    recordedAt:
      row.recordedAt instanceof Date
        ? row.recordedAt.toISOString()
        : String(row.recordedAt),
    retrievedCount: Number(row.retrievedCount ?? 0),
  };
}

function normaliseOutcome(s: string): ReflexionOutcome {
  if (s === 'success' || s === 'failure' || s === 'mixed') return s;
  return 'mixed';
}

function clampLimit(input: number | undefined, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(input), MAX_RECALL_LIMIT);
}

export { reflexionBuffer };
