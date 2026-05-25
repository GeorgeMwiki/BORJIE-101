/**
 * Kernel memory — procedural service.
 *
 * Drizzle-backed adapter for the `kernel_memory_procedural` table
 * (migration 0121). Operations:
 *
 *   - record(args) : upsert by (tenant, user, patternName) — bumps
 *                    invocations, conditionally bumps successes,
 *                    refreshes last_invoked_at.
 *   - match(args)  : scan patterns for a (tenant, user) pair, score by
 *                    keyword-overlap with the user message, rank by
 *                    success rate, return top-K.
 *
 * Hard DB failures degrade to no-op / [] so the kernel never crashes.
 */

import { randomUUID } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { kernelMemoryProcedural } from '../schemas/kernel-memory-procedural.schema.js';
import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';


export interface ProceduralPattern {
  readonly id: string;
  readonly tenantId: string | null;
  readonly userId: string;
  readonly patternName: string;
  readonly toolSequence: ReadonlyArray<string>;
  readonly triggerKeywords: ReadonlyArray<string>;
  readonly invocations: number;
  readonly successes: number;
  readonly successRate: number;
  readonly lastInvokedAt: string | null;
  readonly createdAt: string;
  /** Set on `match` results; otherwise 0. */
  readonly matchScore?: number;
}

export interface RecordArgs {
  readonly tenantId: string | null;
  readonly userId: string;
  readonly patternName: string;
  readonly toolSequence: ReadonlyArray<string>;
  readonly triggerKeywords: ReadonlyArray<string>;
  readonly success: boolean;
}

export interface MatchArgs {
  readonly tenantId: string | null;
  readonly userId: string;
  readonly userMessage: string;
  /** Default 5; bounded to [1, 25]. */
  readonly limit?: number;
}

export interface ProceduralMemoryService {
  record(args: RecordArgs): Promise<void>;
  match(args: MatchArgs): Promise<ReadonlyArray<ProceduralPattern>>;
}

const PATTERN_NAME_MAX_LEN = 120;
const DEFAULT_MATCH_LIMIT = 5;

export function createProceduralMemoryService(
  db: DatabaseClient,
): ProceduralMemoryService {
  return {
    async record(args) {
      try {
        const patternName = (args.patternName ?? '').slice(0, PATTERN_NAME_MAX_LEN);
        if (!patternName || !args.userId) return;

        const toolSequence = Array.isArray(args.toolSequence)
          ? args.toolSequence.slice(0, 50).map((s) => String(s))
          : [];
        const triggerKeywords = Array.isArray(args.triggerKeywords)
          ? args.triggerKeywords
              .slice(0, 50)
              .map((s) => String(s).toLowerCase().trim())
              .filter(Boolean)
          : [];

        await db
          .insert(kernelMemoryProcedural)
          .values({
            id: randomUUID(),
            tenantId: args.tenantId,
            userId: args.userId,
            patternName,
            toolSequence: toolSequence as never,
            triggerKeywords: triggerKeywords as never,
            invocations: 1,
            successes: args.success ? 1 : 0,
            lastInvokedAt: new Date(),
          } as never)
          .onConflictDoUpdate({
            target: [
              kernelMemoryProcedural.tenantId,
              kernelMemoryProcedural.userId,
              kernelMemoryProcedural.patternName,
            ],
            set: {
              toolSequence: toolSequence as never,
              triggerKeywords: triggerKeywords as never,
              invocations: sql`${kernelMemoryProcedural.invocations} + 1`,
              successes: args.success
                ? sql`${kernelMemoryProcedural.successes} + 1`
                : kernelMemoryProcedural.successes,
              lastInvokedAt: new Date(),
            } as never,
          });
      } catch (error) {
        logger.error('kernel-memory-procedural.record failed', { error: error });
      }
    },

    async match(args) {
      try {
        if (!args.userId) return [];
        const limit = clampLimit(args.limit, DEFAULT_MATCH_LIMIT);
        const conds = [eq(kernelMemoryProcedural.userId, args.userId)];
        if (args.tenantId)
          conds.push(eq(kernelMemoryProcedural.tenantId, args.tenantId));

        const rows = await db
          .select(SELECT_COLS)
          .from(kernelMemoryProcedural)
          .where(and(...conds));

        const tokens = tokeniseMessage(args.userMessage);
        if (tokens.length === 0) return [];

        const scored = (rows ?? [])
          .map(rowToPattern)
          .map((p) => ({ ...p, matchScore: scoreOverlap(tokens, p.triggerKeywords) }))
          .filter((p) => (p.matchScore ?? 0) > 0)
          .sort((a, b) => {
            // Primary: keyword-overlap score
            const overlapDelta = (b.matchScore ?? 0) - (a.matchScore ?? 0);
            if (overlapDelta !== 0) return overlapDelta;
            // Secondary: success rate (descending). Patterns with no
            // invocations rank below patterns with at least one
            // success.
            return b.successRate - a.successRate;
          })
          .slice(0, limit);

        return scored;
      } catch (error) {
        logger.error('kernel-memory-procedural.match failed', { error: error });
        return [];
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const SELECT_COLS = {
  id: kernelMemoryProcedural.id,
  tenantId: kernelMemoryProcedural.tenantId,
  userId: kernelMemoryProcedural.userId,
  patternName: kernelMemoryProcedural.patternName,
  toolSequence: kernelMemoryProcedural.toolSequence,
  triggerKeywords: kernelMemoryProcedural.triggerKeywords,
  invocations: kernelMemoryProcedural.invocations,
  successes: kernelMemoryProcedural.successes,
  lastInvokedAt: kernelMemoryProcedural.lastInvokedAt,
  createdAt: kernelMemoryProcedural.createdAt,
} as const;

function clampLimit(input: number | undefined, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(input), 25);
}

function tokeniseMessage(message: string): ReadonlyArray<string> {
  if (!message) return [];
  return message
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
}

function scoreOverlap(
  messageTokens: ReadonlyArray<string>,
  triggers: ReadonlyArray<string>,
): number {
  if (triggers.length === 0) return 0;
  const set = new Set(messageTokens);
  let hits = 0;
  for (const t of triggers) {
    if (set.has(t)) hits++;
  }
  return hits;
}

interface ProceduralRow {
  id: string;
  tenantId: string | null;
  userId: string;
  patternName: string;
  toolSequence: unknown;
  triggerKeywords: unknown;
  invocations: number;
  successes: number;
  lastInvokedAt: Date | string | null;
  createdAt: Date | string;
}

function rowToPattern(row: ProceduralRow): ProceduralPattern {
  const toolSequence = Array.isArray(row.toolSequence)
    ? row.toolSequence.map(String)
    : [];
  const triggerKeywords = Array.isArray(row.triggerKeywords)
    ? row.triggerKeywords.map(String)
    : [];
  const invocations = Number(row.invocations ?? 0);
  const successes = Number(row.successes ?? 0);
  const successRate = invocations > 0 ? successes / invocations : 0;
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    patternName: row.patternName,
    toolSequence,
    triggerKeywords,
    invocations,
    successes,
    successRate,
    lastInvokedAt:
      row.lastInvokedAt === null || row.lastInvokedAt === undefined
        ? null
        : row.lastInvokedAt instanceof Date
          ? row.lastInvokedAt.toISOString()
          : String(row.lastInvokedAt),
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt),
    matchScore: 0,
  };
}
