/**
 * Skill registry — Drizzle-backed service.
 *
 * Voyager-style procedural memory store. The kernel reads at retrieval
 * time (top-K cosine similarity over `description_embedding`); the
 * consolidation worker writes during stage 04-promote.
 *
 * Operations:
 *
 *   - upsertSkill({...})    : promote-or-bump-counters; idempotent on
 *                             (tenant_id, code_hash). Updates the
 *                             embedding + counters when the same skill
 *                             recurs.
 *   - searchByEmbedding({...}) : top-K skills filtered by tenant + status
 *                                ordered by cosine distance. NULLs
 *                                filtered out.
 *   - recordOutcome({...})  : bump success_count / failure_count + set
 *                             last_used_at after a kernel turn that re-
 *                             used a retrieved skill.
 *   - listByTenant({...})   : audit / dashboard listing.
 *   - retire({...})         : flip status to 'retired'.
 *
 * Hard DB failures degrade gracefully: writes log + swallow, reads
 * return null / [] so the kernel never breaks because the registry is
 * unreachable.
 */

import { randomUUID } from 'crypto';
import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { skillRegistry } from '../schemas/skill-registry.schema.js';
import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';


export type SkillStatus = 'active' | 'retired' | 'shadow';

export interface SkillRow {
  readonly id: string;
  readonly tenantId: string | null;
  readonly name: string;
  readonly nlDescription: string;
  readonly toolCallTemplate: unknown;
  readonly successCount: number;
  readonly failureCount: number;
  readonly lastUsedAt: string | null;
  readonly promotedAt: string;
  readonly codeHash: string;
  readonly status: SkillStatus;
}

export interface SkillRowWithSimilarity extends SkillRow {
  /** pgvector cosine distance [0, 2]. Lower is more similar. */
  readonly distance: number;
}

export interface UpsertSkillArgs {
  readonly tenantId: string | null;
  readonly name: string;
  readonly nlDescription: string;
  readonly toolCallTemplate: unknown;
  readonly codeHash: string;
  readonly embedding?: ReadonlyArray<number>;
  readonly status?: SkillStatus;
}

export interface SearchByEmbeddingArgs {
  readonly tenantId: string | null;
  readonly embedding: ReadonlyArray<number>;
  /** Top-K. Default 5. Clamped to [1, 50]. */
  readonly limit?: number;
  /**
   * Max cosine distance [0, 2]. Default 1.0 (anything closer than
   * orthogonal). Tighter values raise precision.
   */
  readonly maxDistance?: number;
  /**
   * When true, include status='active' rows only. When false, all
   * non-retired rows surface (shadow + active). Default true.
   */
  readonly activeOnly?: boolean;
}

export interface RecordOutcomeArgs {
  readonly skillId: string;
  readonly outcome: 'success' | 'failure';
}

export interface ListByTenantArgs {
  readonly tenantId: string | null;
  readonly limit?: number;
  readonly status?: SkillStatus;
}

export interface SkillRegistryService {
  upsertSkill(args: UpsertSkillArgs): Promise<{ id: string; created: boolean }>;
  searchByEmbedding(
    args: SearchByEmbeddingArgs,
  ): Promise<ReadonlyArray<SkillRowWithSimilarity>>;
  recordOutcome(args: RecordOutcomeArgs): Promise<void>;
  listByTenant(args: ListByTenantArgs): Promise<ReadonlyArray<SkillRow>>;
  retire(skillId: string): Promise<void>;
}

const EMBEDDING_DIMS = 1536;
const DEFAULT_SEARCH_LIMIT = 5;
const MAX_SEARCH_LIMIT = 50;
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;
const DEFAULT_MAX_DISTANCE = 1.0;

export function createSkillRegistryService(
  db: DatabaseClient,
): SkillRegistryService {
  return {
    async upsertSkill(args) {
      const id = randomUUID();
      try {
        const name = (args.name ?? '').slice(0, 200).trim();
        const desc = (args.nlDescription ?? '').slice(0, 2_000).trim();
        const codeHash = (args.codeHash ?? '').slice(0, 128).trim();
        if (!name || !desc || !codeHash) {
          throw new Error('name / nlDescription / codeHash are required');
        }
        const status: SkillStatus = args.status ?? 'active';
        const embedding = sanitizeEmbedding(args.embedding);

        const insertValues: Record<string, unknown> = {
          id,
          tenantId: args.tenantId,
          name,
          nlDescription: desc,
          toolCallTemplate: args.toolCallTemplate as never,
          successCount: 0,
          failureCount: 0,
          codeHash,
          status,
        };
        const updateSet: Record<string, unknown> = {
          name,
          nlDescription: desc,
          toolCallTemplate: args.toolCallTemplate as never,
          status,
        };
        if (embedding) {
          insertValues.descriptionEmbedding = embedding as never;
          updateSet.descriptionEmbedding = embedding as never;
        }

        const inserted = (await db
          .insert(skillRegistry)
          .values(insertValues as never)
          .onConflictDoUpdate({
            target: [skillRegistry.tenantId, skillRegistry.codeHash],
            set: updateSet as never,
          })
          .returning({ id: skillRegistry.id })) as ReadonlyArray<{
          id: string;
        }>;

        const returnedId = inserted?.[0]?.id ?? id;
        return { id: returnedId, created: returnedId === id };
      } catch (error) {
        logger.error('skill-registry.upsertSkill failed', { error: error });
        return { id, created: false };
      }
    },

    async searchByEmbedding(args) {
      try {
        const cleaned = sanitizeEmbedding(args.embedding);
        if (!cleaned) return [];
        const limit = clampLimit(
          args.limit,
          DEFAULT_SEARCH_LIMIT,
          MAX_SEARCH_LIMIT,
        );
        const maxDistance = clampDistance(
          args.maxDistance,
          DEFAULT_MAX_DISTANCE,
        );
        const activeOnly = args.activeOnly !== false;
        const queryLiteral = `[${cleaned.join(',')}]`;

        const conds: SQL<unknown>[] = [];
        if (args.tenantId === null) {
          conds.push(isNull(skillRegistry.tenantId));
        } else {
          // Per-tenant: include the tenant's rows AND the global pool
          // (tenant_id IS NULL).
          conds.push(
            sql`(${skillRegistry.tenantId} = ${args.tenantId} OR ${skillRegistry.tenantId} IS NULL)`,
          );
        }
        if (activeOnly) {
          conds.push(eq(skillRegistry.status, 'active'));
        } else {
          conds.push(sql`${skillRegistry.status} <> 'retired'`);
        }
        conds.push(sql`${skillRegistry.descriptionEmbedding} IS NOT NULL`);

        const distanceExpr = sql<number>`${skillRegistry.descriptionEmbedding} <=> ${queryLiteral}::vector`;

        const rows = (await db
          .select({
            ...SELECT_COLS,
            distance: distanceExpr,
          })
          .from(skillRegistry)
          .where(and(...conds))
          .orderBy(distanceExpr)
          .limit(limit)) as ReadonlyArray<SkillRowShape & { distance: number }>;

        return (rows ?? [])
          .filter(
            (r) => Number.isFinite(r.distance) && r.distance <= maxDistance,
          )
          .map((r) => ({
            ...rowToSkill(r),
            distance: Number(r.distance),
          }));
      } catch (error) {
        logger.error('skill-registry.searchByEmbedding failed', { error: error });
        return [];
      }
    },

    async recordOutcome(args) {
      try {
        if (!args.skillId) return;
        const col =
          args.outcome === 'success'
            ? skillRegistry.successCount
            : skillRegistry.failureCount;
        await db
          .update(skillRegistry)
          .set({
            [args.outcome === 'success' ? 'successCount' : 'failureCount']:
              sql`${col} + 1`,
            lastUsedAt: new Date(),
          } as never)
          .where(eq(skillRegistry.id, args.skillId));
      } catch (error) {
        logger.error('skill-registry.recordOutcome failed', { error: error });
      }
    },

    async listByTenant(args) {
      try {
        const limit = clampLimit(
          args.limit,
          DEFAULT_LIST_LIMIT,
          MAX_LIST_LIMIT,
        );
        const conds: SQL<unknown>[] = [];
        if (args.tenantId === null) {
          conds.push(isNull(skillRegistry.tenantId));
        } else {
          conds.push(eq(skillRegistry.tenantId, args.tenantId));
        }
        if (args.status) {
          conds.push(eq(skillRegistry.status, args.status));
        }

        const rows = (await db
          .select(SELECT_COLS)
          .from(skillRegistry)
          .where(and(...conds))
          .orderBy(desc(skillRegistry.promotedAt))
          .limit(limit)) as ReadonlyArray<SkillRowShape>;

        return (rows ?? []).map(rowToSkill);
      } catch (error) {
        logger.error('skill-registry.listByTenant failed', { error: error });
        return [];
      }
    },

    async retire(skillId) {
      try {
        if (!skillId) return;
        await db
          .update(skillRegistry)
          .set({ status: 'retired' } as never)
          .where(eq(skillRegistry.id, skillId));
      } catch (error) {
        logger.error('skill-registry.retire failed', { error: error });
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const SELECT_COLS = {
  id: skillRegistry.id,
  tenantId: skillRegistry.tenantId,
  name: skillRegistry.name,
  nlDescription: skillRegistry.nlDescription,
  toolCallTemplate: skillRegistry.toolCallTemplate,
  successCount: skillRegistry.successCount,
  failureCount: skillRegistry.failureCount,
  lastUsedAt: skillRegistry.lastUsedAt,
  promotedAt: skillRegistry.promotedAt,
  codeHash: skillRegistry.codeHash,
  status: skillRegistry.status,
} as const;

interface SkillRowShape {
  id: string;
  tenantId: string | null;
  name: string;
  nlDescription: string;
  toolCallTemplate: unknown;
  successCount: number;
  failureCount: number;
  lastUsedAt: Date | string | null;
  promotedAt: Date | string;
  codeHash: string;
  status: string;
}

function rowToSkill(row: SkillRowShape): SkillRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    nlDescription: row.nlDescription,
    toolCallTemplate: row.toolCallTemplate,
    successCount: Number(row.successCount ?? 0),
    failureCount: Number(row.failureCount ?? 0),
    lastUsedAt:
      row.lastUsedAt === null || row.lastUsedAt === undefined
        ? null
        : row.lastUsedAt instanceof Date
          ? row.lastUsedAt.toISOString()
          : String(row.lastUsedAt),
    promotedAt:
      row.promotedAt instanceof Date
        ? row.promotedAt.toISOString()
        : String(row.promotedAt),
    codeHash: row.codeHash,
    status: normaliseStatus(row.status),
  };
}

function normaliseStatus(s: string): SkillStatus {
  if (s === 'retired' || s === 'shadow' || s === 'active') return s;
  return 'active';
}

function sanitizeEmbedding(
  raw: ReadonlyArray<number> | undefined,
): number[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) return undefined;
  if (raw.length !== EMBEDDING_DIMS) {
    logger.warn(`skill-registry: dropping embedding — expected ${EMBEDDING_DIMS} dims, got ${raw.length}`);
    return undefined;
  }
  const cleaned: number[] = new Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    const n = Number(raw[i]);
    if (!Number.isFinite(n)) {
      logger.warn(`skill-registry: dropping embedding — non-finite at index ${i}`);
      return undefined;
    }
    cleaned[i] = n;
  }
  return cleaned;
}

function clampLimit(
  input: number | undefined,
  fallback: number,
  hardCap: number,
): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(input), hardCap);
}

function clampDistance(input: number | undefined, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return fallback;
  if (input < 0) return 0;
  if (input > 2) return 2;
  return input;
}

export { skillRegistry };
