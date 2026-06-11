/**
 * Reflexion loader — Drizzle-backed READ adapter for the compounding loop.
 *
 * This closes the read-back side of the verbal-RL loop. The kernel WRITES
 * reflexions on surprise (write-at-session-end) and the 4-pass nightly
 * sleep consolidates them into `reflexion_guidelines`; this service is the
 * task-scoped READ point the kernel calls at session start
 * (`ReflexionLoaderPort` in `@borjie/central-intelligence`) to fold the
 * consolidated lessons back into its reasoning context.
 *
 * It is DISTINCT from `createReflexionBufferService(db).recall`:
 *   - `recall` is per-(tenant, user) REQUIRED and reads only `reflexion_buffer`.
 *   - this loader is TENANT-WIDE with userId OPTIONAL (tenant-level rows plus
 *     this-user rows), filters `pruned_at IS NULL`, surfaces
 *     importance/taskId/clusterId, AND reads the SEPARATE
 *     `reflexion_guidelines` table (pass-3 consolidation output).
 *
 * Hard DB failures degrade gracefully — a null db or any query error returns
 * `[]`. The kernel treats this as a side-channel and NEVER breaks a turn
 * because the reflexion store is unreachable.
 *
 * Structural duck-typing: this file does NOT import from
 * `@borjie/central-intelligence` (the package has no such dependency). The
 * returned shape STRUCTURALLY satisfies the kernel's `ReflexionLoaderPort`;
 * the gateway composition root binds it onto the kernel deps.
 */

import { and, desc, eq, isNull, or } from 'drizzle-orm';
import {
  reflexionBuffer,
  reflexionGuidelines,
} from '../schemas/reflexion-buffer.schema.js';
import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';

export type ReflexionOutcome = 'success' | 'failure' | 'mixed';

/**
 * Mirrors `@borjie/central-intelligence` `LoadedReflexion` structurally.
 * Kept local because @borjie/database does not depend on the kernel package.
 */
export interface LoadedReflexion {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly taskId: string | null;
  readonly reflection: string;
  readonly outcome: ReflexionOutcome;
  readonly importance: number;
  readonly recordedAt: string;
  readonly clusterId: string | null;
}

/** Mirrors `@borjie/central-intelligence` `LoadedGuideline` structurally. */
export interface LoadedGuideline {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string | null;
  readonly slug: string;
  readonly body: string;
  readonly confidence: number;
  readonly updatedAt: string;
}

export interface RecentReflexionsArgs {
  readonly tenantId: string;
  readonly limit: number;
  /** Optional. When set, returns tenant-wide rows PLUS this user's rows. */
  readonly userId?: string;
}

export interface RecentGuidelinesArgs {
  readonly tenantId: string;
  readonly limit: number;
  /** Optional. When set, returns tenant-wide rows PLUS this user's rows. */
  readonly userId?: string;
}

/**
 * Structurally satisfies the kernel's `ReflexionLoaderPort`.
 * (`recentReflexions` + `recentGuidelines`.)
 */
export interface ReflexionLoaderService {
  recentReflexions(
    args: RecentReflexionsArgs,
  ): Promise<ReadonlyArray<LoadedReflexion>>;
  recentGuidelines(
    args: RecentGuidelinesArgs,
  ): Promise<ReadonlyArray<LoadedGuideline>>;
}

const MAX_LIMIT = 25;
const DEFAULT_LIMIT = 5;

/**
 * Build the Drizzle-backed reflexion loader. `db` is the same
 * `DatabaseClient` the sibling reflexion-buffer service takes; pass a
 * nullish db to get a no-op loader (every method returns []).
 */
export function createDrizzleReflexionLoader(
  db: DatabaseClient | null | undefined,
): ReflexionLoaderService {
  return {
    async recentReflexions(args) {
      try {
        if (!db || !args.tenantId) return [];
        const limit = clampLimit(args.limit);

        // TENANT-WIDE, userId OPTIONAL: when a userId is supplied we still
        // return tenant-level rows (the loader collapses both scopes). The
        // user filter is a SUPERSET, not a restriction, so a brand-new
        // user still inherits every tenant-wide lesson.
        const scope = args.userId
          ? or(
              isNull(reflexionBuffer.userId),
              eq(reflexionBuffer.userId, args.userId),
            )
          : undefined;

        const rows = (await db
          .select(REFLEXION_COLS)
          .from(reflexionBuffer)
          .where(
            and(
              eq(reflexionBuffer.tenantId, args.tenantId),
              isNull(reflexionBuffer.prunedAt),
              ...(scope ? [scope] : []),
            ),
          )
          .orderBy(
            desc(reflexionBuffer.importance),
            desc(reflexionBuffer.recordedAt),
          )
          .limit(limit)) as ReadonlyArray<ReflexionRow>;

        return (rows ?? []).map(rowToReflexion);
      } catch (error) {
        logger.error('reflexion-loader.recentReflexions failed', { error });
        return [];
      }
    },

    async recentGuidelines(args) {
      try {
        if (!db || !args.tenantId) return [];
        const limit = clampLimit(args.limit);

        // TENANT-WIDE, userId OPTIONAL. `reflexion_guidelines.user_id` is
        // NULL for tenant-wide rows; a supplied userId returns BOTH the
        // tenant-wide rows and this user's rows.
        const scope = args.userId
          ? or(
              isNull(reflexionGuidelines.userId),
              eq(reflexionGuidelines.userId, args.userId),
            )
          : undefined;

        const rows = (await db
          .select(GUIDELINE_COLS)
          .from(reflexionGuidelines)
          .where(
            and(
              eq(reflexionGuidelines.tenantId, args.tenantId),
              ...(scope ? [scope] : []),
            ),
          )
          .orderBy(
            desc(reflexionGuidelines.confidence),
            desc(reflexionGuidelines.updatedAt),
          )
          .limit(limit)) as ReadonlyArray<GuidelineRow>;

        return (rows ?? []).map(rowToGuideline);
      } catch (error) {
        logger.error('reflexion-loader.recentGuidelines failed', { error });
        return [];
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Column projections
// ─────────────────────────────────────────────────────────────────────

const REFLEXION_COLS = {
  id: reflexionBuffer.id,
  tenantId: reflexionBuffer.tenantId,
  userId: reflexionBuffer.userId,
  sessionId: reflexionBuffer.sessionId,
  taskId: reflexionBuffer.taskId,
  reflection: reflexionBuffer.reflection,
  outcome: reflexionBuffer.outcome,
  importance: reflexionBuffer.importance,
  recordedAt: reflexionBuffer.recordedAt,
  clusterId: reflexionBuffer.clusterId,
} as const;

const GUIDELINE_COLS = {
  id: reflexionGuidelines.id,
  tenantId: reflexionGuidelines.tenantId,
  userId: reflexionGuidelines.userId,
  slug: reflexionGuidelines.slug,
  body: reflexionGuidelines.body,
  confidence: reflexionGuidelines.confidence,
  updatedAt: reflexionGuidelines.updatedAt,
} as const;

// ─────────────────────────────────────────────────────────────────────
// Row → entry mappers
// ─────────────────────────────────────────────────────────────────────

interface ReflexionRow {
  id: string;
  tenantId: string;
  userId: string | null;
  sessionId: string | null;
  taskId: string | null;
  reflection: string;
  outcome: string;
  importance: number | string | null;
  recordedAt: Date | string;
  clusterId: string | null;
}

interface GuidelineRow {
  id: string;
  tenantId: string;
  userId: string | null;
  slug: string;
  body: string;
  confidence: number | string | null;
  updatedAt: Date | string;
}

function rowToReflexion(row: ReflexionRow): LoadedReflexion {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId ?? '',
    sessionId: row.sessionId ?? '',
    taskId: row.taskId ?? null,
    reflection: row.reflection,
    outcome: normaliseOutcome(row.outcome),
    importance: toNumber(row.importance, 0.5),
    recordedAt: toIso(row.recordedAt),
    clusterId: row.clusterId ?? null,
  };
}

function rowToGuideline(row: GuidelineRow): LoadedGuideline {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId ?? null,
    slug: row.slug,
    body: row.body,
    confidence: toNumber(row.confidence, 0.5),
    updatedAt: toIso(row.updatedAt),
  };
}

function normaliseOutcome(s: string): ReflexionOutcome {
  if (s === 'success' || s === 'failure' || s === 'mixed') return s;
  return 'mixed';
}

function toNumber(v: number | string | null | undefined, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function clampLimit(input: number | undefined): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(input), MAX_LIMIT);
}
