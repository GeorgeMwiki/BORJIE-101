/**
 * Kernel memory — episodic service.
 *
 * Drizzle-backed adapter for the `kernel_memory_episodic` table
 * (migration 0121). Three operations:
 *
 *   - record(args)        : append one episodic row.
 *                           ttlDays default 90; null disables TTL.
 *   - recall(args)        : read recent episodes for a (tenant, user)
 *                           pair, optionally bounded by a `since` cutoff.
 *   - purgeExpired()      : delete rows whose expires_at is past now.
 *                           Called by the nightly consolidation cycle.
 *
 * Every method is wrapped so a hard DB failure degrades to a no-op /
 * empty-array return — the kernel must never crash because the memory
 * side-channel is unreachable.
 *
 * Port shape duck-typed locally so this package does NOT compile-time
 * depend on @borjie/central-intelligence.
 */

import { randomUUID } from 'crypto';
import { and, eq, gte, lt, sql, desc } from 'drizzle-orm';
import { kernelMemoryEpisodic } from '../schemas/kernel-memory-episodic.schema.js';
import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';


export type EpisodicKind = 'user-message' | 'agent-action' | 'tool-result';

export interface EpisodicEntry {
  readonly id: string;
  readonly tenantId: string | null;
  readonly userId: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly kind: EpisodicKind;
  readonly summary: string;
  readonly payload: Record<string, unknown>;
  readonly capturedAt: string;
  readonly expiresAt: string | null;
}

export interface EpisodicRecordArgs {
  readonly tenantId: string | null;
  readonly userId: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly kind: EpisodicKind;
  readonly summary: string;
  readonly payload?: Record<string, unknown>;
  /** Default 90; pass `null` to skip the TTL. */
  readonly ttlDays?: number | null;
}

export interface EpisodicRecallArgs {
  readonly tenantId: string | null;
  readonly userId: string;
  readonly since?: string;
  readonly limit?: number;
}

export interface EpisodicMemoryService {
  record(args: EpisodicRecordArgs): Promise<void>;
  recall(args: EpisodicRecallArgs): Promise<ReadonlyArray<EpisodicEntry>>;
  purgeExpired(): Promise<number>;
}

const DEFAULT_TTL_DAYS = 90;
const MAX_SUMMARY_LEN = 1000;

export function createEpisodicMemoryService(
  db: DatabaseClient,
): EpisodicMemoryService {
  return {
    async record(args) {
      try {
        const summary = (args.summary ?? '').slice(0, MAX_SUMMARY_LEN);
        if (!args.userId || !args.threadId || !args.turnId) return;

        const ttlDays =
          args.ttlDays === null
            ? null
            : Number.isFinite(args.ttlDays)
              ? Number(args.ttlDays)
              : DEFAULT_TTL_DAYS;
        const expiresAt =
          ttlDays === null
            ? null
            : new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

        await db
          .insert(kernelMemoryEpisodic)
          .values({
            id: randomUUID(),
            tenantId: args.tenantId,
            userId: args.userId,
            threadId: args.threadId,
            turnId: args.turnId,
            kind: args.kind,
            summary,
            payload: args.payload ?? {},
            expiresAt,
          } as never)
          .onConflictDoNothing();
      } catch (error) {
        // Memory is a side-channel; log + swallow.
        logger.error('kernel-memory-episodic.record failed', { error: error });
      }
    },

    async recall(args) {
      try {
        const limit = clampLimit(args.limit, 50);
        const conds = [
          eq(kernelMemoryEpisodic.userId, args.userId),
        ];
        if (args.tenantId)
          conds.push(eq(kernelMemoryEpisodic.tenantId, args.tenantId));
        if (args.since) {
          const sinceDate = new Date(args.since);
          if (!Number.isNaN(sinceDate.getTime())) {
            conds.push(gte(kernelMemoryEpisodic.capturedAt, sinceDate));
          }
        }

        const rows = await db
          .select({
            id: kernelMemoryEpisodic.id,
            tenantId: kernelMemoryEpisodic.tenantId,
            userId: kernelMemoryEpisodic.userId,
            threadId: kernelMemoryEpisodic.threadId,
            turnId: kernelMemoryEpisodic.turnId,
            kind: kernelMemoryEpisodic.kind,
            summary: kernelMemoryEpisodic.summary,
            payload: kernelMemoryEpisodic.payload,
            capturedAt: kernelMemoryEpisodic.capturedAt,
            expiresAt: kernelMemoryEpisodic.expiresAt,
          })
          .from(kernelMemoryEpisodic)
          .where(and(...conds))
          .orderBy(desc(kernelMemoryEpisodic.capturedAt))
          .limit(limit);

        return (rows ?? []).map(rowToEntry);
      } catch (error) {
        logger.error('kernel-memory-episodic.recall failed', { error: error });
        return [];
      }
    },

    async purgeExpired() {
      try {
        const now = new Date();
        const out = (await db
          .delete(kernelMemoryEpisodic)
          .where(lt(kernelMemoryEpisodic.expiresAt, now))
          .returning({ id: kernelMemoryEpisodic.id })) as ReadonlyArray<{
          id: string;
        }>;
        return Array.isArray(out) ? out.length : 0;
      } catch (error) {
        logger.error('kernel-memory-episodic.purgeExpired failed', { error: error });
        return 0;
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function clampLimit(input: number | undefined, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(input), 1000);
}

interface EpisodicRow {
  id: string;
  tenantId: string | null;
  userId: string;
  threadId: string;
  turnId: string;
  kind: string;
  summary: string;
  payload: unknown;
  capturedAt: Date | string;
  expiresAt: Date | string | null;
}

function rowToEntry(row: EpisodicRow): EpisodicEntry {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    threadId: row.threadId,
    turnId: row.turnId,
    kind: row.kind as EpisodicKind,
    summary: row.summary,
    payload:
      row.payload && typeof row.payload === 'object'
        ? (row.payload as Record<string, unknown>)
        : {},
    capturedAt:
      row.capturedAt instanceof Date
        ? row.capturedAt.toISOString()
        : String(row.capturedAt),
    expiresAt:
      row.expiresAt === null
        ? null
        : row.expiresAt instanceof Date
          ? row.expiresAt.toISOString()
          : String(row.expiresAt),
  };
}

// Suppress unused-import lint while keeping `sql` available for future
// raw filters (e.g. expires_at IS NOT NULL).
void sql;
