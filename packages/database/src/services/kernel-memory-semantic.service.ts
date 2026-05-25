/**
 * Kernel memory — semantic service.
 *
 * Drizzle-backed adapter for the `kernel_memory_semantic` table
 * (migration 0121). Operations:
 *
 *   - upsertFact(args)        : insert-or-update by (tenant, user, key)
 *                               with evidence_count bump + last_seen_at
 *                               refresh. Accepts an optional embedding
 *                               (1536-dim, added in migration 0125).
 *   - lookup(args)            : fetch a single fact by (tenant, user,
 *                               key). Returns null when no row.
 *   - search(args)            : list facts for a (tenant, user) pair,
 *                               optional prefix-match on `key`, ranked
 *                               by last_seen_at DESC. Bounded by
 *                               `limit` (default 25).
 *   - searchByEmbedding(args) : query-conditioned retrieval —
 *                               pgvector `<=>` cosine distance against
 *                               the caller's query embedding. NULL
 *                               embeddings are filtered out. Returns
 *                               the top-K facts ranked by similarity.
 *                               Migration 0125 + LITFIN parity gap C.
 *   - decay(args)             : multiplicative confidence decay across
 *                               all facts in a tenant. For the nightly
 *                               cycle.
 *
 * Hard DB failures degrade to no-ops / null / [] — the kernel never
 * crashes because the semantic store is unreachable.
 */

import { randomUUID } from 'crypto';
import { and, eq, like, sql, desc, isNull, count, type SQL } from 'drizzle-orm';
import { kernelMemorySemantic } from '../schemas/kernel-memory-semantic.schema.js';
import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';


/**
 * Per-user cap on declared facts — protects the kernel memory store
 * from abuse (memory amplification, JSON-bomb storage). Enforced when
 * `source === 'declared'`; extracted / consolidated facts come from
 * platform-trusted pipelines and bypass the cap.
 */
export const DECLARED_FACTS_PER_USER_CAP = 500;

/**
 * Typed error raised by `upsertFact` when an insert would push a user
 * over the cap. The router translates this into HTTP 429 with
 * `{ error: { code: 'declared-facts-cap' } }`.
 */
export class DeclaredFactsCapExceededError extends Error {
  readonly code = 'declared-facts-cap' as const;
  readonly cap: number;
  constructor(cap: number) {
    super(`Maximum ${cap} declared facts per user.`);
    this.name = 'DeclaredFactsCapExceededError';
    this.cap = cap;
  }
}

export type SemanticSource = 'extracted' | 'declared' | 'consolidated';

export interface SemanticFact {
  readonly id: string;
  readonly tenantId: string | null;
  readonly userId: string | null;
  readonly key: string;
  readonly value: unknown;
  readonly confidence: number;
  readonly sourceTurnId: string | null;
  readonly evidenceCount: number;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly expiresAt: string | null;
  readonly source: SemanticSource;
}

export interface UpsertFactArgs {
  readonly tenantId: string | null;
  readonly userId?: string | null;
  readonly key: string;
  readonly value: unknown;
  readonly confidence: number;
  readonly sourceTurnId?: string | null;
  readonly source?: SemanticSource;
  /**
   * Optional 1536-dim embedding (text-embedding-3-small). When
   * provided, persisted into the pgvector column for query-conditioned
   * retrieval via `searchByEmbedding`. Wrong dimensionality is dropped
   * (logged) so an out-of-spec embedding never corrupts the table.
   */
  readonly embedding?: ReadonlyArray<number>;
}

export interface LookupArgs {
  readonly tenantId: string | null;
  readonly userId?: string | null;
  readonly key: string;
}

export interface SearchArgs {
  readonly tenantId: string | null;
  readonly userId?: string | null;
  readonly prefix?: string;
  readonly limit?: number;
}

export interface SearchByEmbeddingArgs {
  readonly tenantId: string | null;
  readonly userId?: string | null;
  /** 1536-dim query embedding (text-embedding-3-small). */
  readonly embedding: ReadonlyArray<number>;
  readonly limit?: number;
  /**
   * Maximum cosine distance (0 = identical, 2 = opposite). Facts with
   * `<=> embedding > maxDistance` are filtered out. Default 1.0 — i.e.
   * "anything closer than orthogonal." Tighten for higher precision.
   */
  readonly maxDistance?: number;
}

export interface SemanticFactWithSimilarity extends SemanticFact {
  /** Cosine distance (0 = identical). Lower is better. */
  readonly distance: number;
}

export interface DecayArgs {
  readonly tenantId: string | null;
  /** Multiplicative factor per day; e.g. 0.99 = 1% daily decay. */
  readonly decayPerDay: number;
}

export interface SemanticMemoryService {
  upsertFact(args: UpsertFactArgs): Promise<void>;
  lookup(args: LookupArgs): Promise<SemanticFact | null>;
  search(args: SearchArgs): Promise<ReadonlyArray<SemanticFact>>;
  searchByEmbedding(
    args: SearchByEmbeddingArgs,
  ): Promise<ReadonlyArray<SemanticFactWithSimilarity>>;
  decay(args: DecayArgs): Promise<number>;
}

const KEY_MAX_LEN = 200;
const DEFAULT_SEARCH_LIMIT = 25;
const DEFAULT_EMBEDDING_SEARCH_LIMIT = 8;
const EMBEDDING_DIMS = 1536;
const DEFAULT_MAX_DISTANCE = 1.0;

export function createSemanticMemoryService(
  db: DatabaseClient,
): SemanticMemoryService {
  return {
    async upsertFact(args) {
      try {
        const key = (args.key ?? '').slice(0, KEY_MAX_LEN);
        if (!key) return;
        const confidence = clamp01(args.confidence);
        const userId = args.userId ?? null;
        const source: SemanticSource = args.source ?? 'extracted';
        const embedding = sanitizeEmbedding(args.embedding);

        // A2b-3 wire #5 — per-user declared-facts cap. Only enforced
        // for `source === 'declared'` (user-driven writes); extracted /
        // consolidated facts come from platform-trusted pipelines.
        // Re-upserting an existing (tenant, user, key) is an update,
        // not an insert, so we exempt that case from the cap check.
        if (source === 'declared' && userId) {
          const existingByKey = await db
            .select({ id: kernelMemorySemantic.id })
            .from(kernelMemorySemantic)
            .where(
              and(
                args.tenantId
                  ? eq(kernelMemorySemantic.tenantId, args.tenantId)
                  : isNull(kernelMemorySemantic.tenantId),
                eq(kernelMemorySemantic.userId, userId),
                eq(kernelMemorySemantic.key, key),
              ),
            )
            .limit(1);
          const isUpdate =
            Array.isArray(existingByKey) && existingByKey.length > 0;
          if (!isUpdate) {
            const countRows = await db
              .select({ n: count() })
              .from(kernelMemorySemantic)
              .where(
                and(
                  args.tenantId
                    ? eq(kernelMemorySemantic.tenantId, args.tenantId)
                    : isNull(kernelMemorySemantic.tenantId),
                  eq(kernelMemorySemantic.userId, userId),
                  eq(kernelMemorySemantic.source, 'declared'),
                ),
              );
            const total = Number(
              (countRows as ReadonlyArray<{ n: number }>)[0]?.n ?? 0,
            );
            if (total >= DECLARED_FACTS_PER_USER_CAP) {
              throw new DeclaredFactsCapExceededError(
                DECLARED_FACTS_PER_USER_CAP,
              );
            }
          }
        }

        const insertValues: Record<string, unknown> = {
          id: randomUUID(),
          tenantId: args.tenantId,
          userId,
          key,
          value: args.value as never,
          confidence,
          sourceTurnId: args.sourceTurnId ?? null,
          evidenceCount: 1,
          source,
        };
        const updateSet: Record<string, unknown> = {
          value: args.value as never,
          confidence,
          sourceTurnId: args.sourceTurnId ?? null,
          evidenceCount: sql`${kernelMemorySemantic.evidenceCount} + 1`,
          lastSeenAt: new Date(),
          source,
        };
        if (embedding) {
          insertValues.embedding = embedding as never;
          updateSet.embedding = embedding as never;
        }

        await db
          .insert(kernelMemorySemantic)
          .values(insertValues as never)
          .onConflictDoUpdate({
            target: [
              kernelMemorySemantic.tenantId,
              kernelMemorySemantic.userId,
              kernelMemorySemantic.key,
            ],
            set: updateSet as never,
          });
      } catch (error) {
        // Cap-exceeded is a typed signal the router needs to see —
        // re-throw so it can return HTTP 429 instead of silently
        // dropping the write.
        if (error instanceof DeclaredFactsCapExceededError) {
          throw error;
        }
        logger.error('kernel-memory-semantic.upsertFact failed', { error: error });
      }
    },

    async lookup(args) {
      try {
        const key = (args.key ?? '').slice(0, KEY_MAX_LEN);
        if (!key) return null;
        const conds = [eq(kernelMemorySemantic.key, key)];
        if (args.tenantId)
          conds.push(eq(kernelMemorySemantic.tenantId, args.tenantId));
        if (args.userId === null || args.userId === undefined) {
          conds.push(isNull(kernelMemorySemantic.userId));
        } else {
          conds.push(eq(kernelMemorySemantic.userId, args.userId));
        }

        const rows = await db
          .select(SELECT_COLS)
          .from(kernelMemorySemantic)
          .where(and(...conds))
          .limit(1);

        const hit = Array.isArray(rows) ? rows[0] : undefined;
        return hit ? rowToFact(hit) : null;
      } catch (error) {
        logger.error('kernel-memory-semantic.lookup failed', { error: error });
        return null;
      }
    },

    async search(args) {
      try {
        const limit = clampLimit(args.limit, DEFAULT_SEARCH_LIMIT);
        const conds: SQL<unknown>[] = [];
        if (args.tenantId)
          conds.push(eq(kernelMemorySemantic.tenantId, args.tenantId));
        if (args.userId === null) {
          conds.push(isNull(kernelMemorySemantic.userId));
        } else if (args.userId !== undefined) {
          conds.push(eq(kernelMemorySemantic.userId, args.userId));
        }
        if (args.prefix && args.prefix.length > 0) {
          // Postgres LIKE — escape % and _ defensively.
          const safe = args.prefix.replace(/[\\%_]/g, '\\$&');
          conds.push(like(kernelMemorySemantic.key, `${safe}%`));
        }

        const rows = await db
          .select(SELECT_COLS)
          .from(kernelMemorySemantic)
          .where(conds.length > 0 ? and(...conds) : undefined)
          .orderBy(desc(kernelMemorySemantic.lastSeenAt))
          .limit(limit);

        return (rows ?? []).map(rowToFact);
      } catch (error) {
        logger.error('kernel-memory-semantic.search failed', { error: error });
        return [];
      }
    },

    async searchByEmbedding(args) {
      try {
        const cleaned = sanitizeEmbedding(args.embedding);
        if (!cleaned) return [];
        const limit = clampLimit(
          args.limit,
          DEFAULT_EMBEDDING_SEARCH_LIMIT,
        );
        const maxDistance = clampDistance(
          args.maxDistance,
          DEFAULT_MAX_DISTANCE,
        );
        const queryLiteral = `[${cleaned.join(',')}]`;

        const conds: SQL<unknown>[] = [];
        if (args.tenantId)
          conds.push(eq(kernelMemorySemantic.tenantId, args.tenantId));
        if (args.userId === null) {
          conds.push(isNull(kernelMemorySemantic.userId));
        } else if (args.userId !== undefined) {
          conds.push(eq(kernelMemorySemantic.userId, args.userId));
        }
        // Exclude NULL embeddings — pgvector distance against NULL is
        // undefined and would surface as NaN.
        conds.push(sql`${kernelMemorySemantic.embedding} IS NOT NULL`);

        const distanceExpr = sql<number>`${kernelMemorySemantic.embedding} <=> ${queryLiteral}::vector`;

        const rows = (await db
          .select({
            ...SELECT_COLS,
            distance: distanceExpr,
          })
          .from(kernelMemorySemantic)
          .where(conds.length > 0 ? and(...conds) : undefined)
          .orderBy(distanceExpr)
          .limit(limit)) as ReadonlyArray<SemanticRow & { distance: number }>;

        return (rows ?? [])
          .filter((r) => Number.isFinite(r.distance) && r.distance <= maxDistance)
          .map((r) => ({
            ...rowToFact(r),
            distance: Number(r.distance),
          }));
      } catch (error) {
        logger.error('kernel-memory-semantic.searchByEmbedding failed', { error: error });
        return [];
      }
    },

    async decay(args) {
      try {
        const factor = Number(args.decayPerDay);
        if (!Number.isFinite(factor) || factor <= 0 || factor > 1) {
          return 0;
        }
        const conds: SQL<unknown>[] = [];
        if (args.tenantId)
          conds.push(eq(kernelMemorySemantic.tenantId, args.tenantId));

        const out = (await db
          .update(kernelMemorySemantic)
          .set({
            confidence: sql`${kernelMemorySemantic.confidence} * ${factor}`,
          } as never)
          .where(conds.length > 0 ? and(...conds) : undefined)
          .returning({ id: kernelMemorySemantic.id })) as ReadonlyArray<{
          id: string;
        }>;
        return Array.isArray(out) ? out.length : 0;
      } catch (error) {
        logger.error('kernel-memory-semantic.decay failed', { error: error });
        return 0;
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const SELECT_COLS = {
  id: kernelMemorySemantic.id,
  tenantId: kernelMemorySemantic.tenantId,
  userId: kernelMemorySemantic.userId,
  key: kernelMemorySemantic.key,
  value: kernelMemorySemantic.value,
  confidence: kernelMemorySemantic.confidence,
  sourceTurnId: kernelMemorySemantic.sourceTurnId,
  evidenceCount: kernelMemorySemantic.evidenceCount,
  firstSeenAt: kernelMemorySemantic.firstSeenAt,
  lastSeenAt: kernelMemorySemantic.lastSeenAt,
  expiresAt: kernelMemorySemantic.expiresAt,
  source: kernelMemorySemantic.source,
} as const;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function clampLimit(input: number | undefined, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(input), 1000);
}

/**
 * pgvector cosine distance is in [0, 2]. We clamp callers' inputs to
 * that range and fall back to the default when the input is malformed.
 */
function clampDistance(input: number | undefined, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return fallback;
  if (input < 0) return 0;
  if (input > 2) return 2;
  return input;
}

/**
 * Validate an optional caller-supplied embedding before it touches the
 * pgvector column. Out-of-spec embeddings (wrong dimensionality, NaN /
 * ±Infinity entries) are dropped — we log and return `undefined` so the
 * caller's `upsertFact` proceeds without an embedding rather than
 * corrupting the table. A successful pass returns a frozen,
 * `number[]`-typed copy.
 */
function sanitizeEmbedding(
  raw: ReadonlyArray<number> | undefined,
): number[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) return undefined;
  if (raw.length !== EMBEDDING_DIMS) {
    logger.warn(`kernel-memory-semantic: dropping embedding — expected ${EMBEDDING_DIMS} dims, got ${raw.length}`);
    return undefined;
  }
  const cleaned: number[] = new Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    const n = Number(raw[i]);
    if (!Number.isFinite(n)) {
      logger.warn(`kernel-memory-semantic: dropping embedding — non-finite value at index ${i}`);
      return undefined;
    }
    cleaned[i] = n;
  }
  return cleaned;
}

interface SemanticRow {
  id: string;
  tenantId: string | null;
  userId: string | null;
  key: string;
  value: unknown;
  confidence: number;
  sourceTurnId: string | null;
  evidenceCount: number;
  firstSeenAt: Date | string;
  lastSeenAt: Date | string;
  expiresAt: Date | string | null;
  source: string;
}

function rowToFact(row: SemanticRow): SemanticFact {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    key: row.key,
    value: row.value,
    confidence: Number(row.confidence ?? 0),
    sourceTurnId: row.sourceTurnId,
    evidenceCount: Number(row.evidenceCount ?? 0),
    firstSeenAt:
      row.firstSeenAt instanceof Date
        ? row.firstSeenAt.toISOString()
        : String(row.firstSeenAt),
    lastSeenAt:
      row.lastSeenAt instanceof Date
        ? row.lastSeenAt.toISOString()
        : String(row.lastSeenAt),
    expiresAt:
      row.expiresAt === null
        ? null
        : row.expiresAt instanceof Date
          ? row.expiresAt.toISOString()
          : String(row.expiresAt),
    source: row.source as SemanticSource,
  };
}
