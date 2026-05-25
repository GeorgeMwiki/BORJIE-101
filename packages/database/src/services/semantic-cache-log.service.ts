/**
 * Semantic cache log — Drizzle-backed telemetry sink.
 *
 * Backs the `SemanticCacheTelemetrySink` port consumed by the
 * `@borjie/central-intelligence` semantic-cache layer (Phase D D4).
 *
 * Operations:
 *
 *   - record(args)         : insert one telemetry row. Fire-and-forget;
 *                            failures log + swallow so the cache layer
 *                            never breaks a user turn.
 *   - rollupForTenant(...) : per-tenant aggregate over the last N days
 *                            with hit-rate, miss-rate, and saved/spent
 *                            cost. Drives the cost-savings dashboard.
 *   - hitRateForTenant(...) : convenience — just the ratio plus row count.
 *
 * Hard DB failures degrade: writes log + swallow; reads return a
 * zeroed rollup so the dashboard keeps shaping cleanly.
 */

import { randomUUID } from 'crypto';
import { and, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { semanticCacheLog } from '../schemas/semantic-cache-log.schema.js';
import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export type SemanticCacheOutcome = 'hit' | 'miss' | 'skip';

export interface RecordSemanticCacheEventArgs {
  /** NULL only for platform-tier (sovereign) turns. */
  readonly tenantId: string | null;
  readonly surface: string;
  readonly personaId: string;
  readonly outcome: SemanticCacheOutcome;
  readonly intent: string;
  readonly similarity: number | null;
  readonly threshold: number;
  readonly modelId: string;
  readonly costUsdMicros: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly skipReason: string | null;
  /** ISO string. */
  readonly occurredAt: string;
}

export interface SemanticCacheRollup {
  readonly totalLookups: number;
  readonly hits: number;
  readonly misses: number;
  readonly skips: number;
  /** hits / (hits + misses) — 0 when no lookups have happened. */
  readonly hitRate: number;
  /** Sum of cost_usd_micros across HITS only (what we saved). */
  readonly costSavedUsdMicros: number;
  /** Sum of cost_usd_micros across MISSES only (what we spent). */
  readonly costSpentUsdMicros: number;
}

export interface SemanticCacheLogService {
  record(args: RecordSemanticCacheEventArgs): Promise<{ id: string } | null>;
  rollupForTenant(args: {
    readonly tenantId: string | null;
    readonly sinceDays: number;
  }): Promise<SemanticCacheRollup>;
  hitRateForTenant(args: {
    readonly tenantId: string | null;
    readonly sinceDays: number;
  }): Promise<{ readonly hitRate: number; readonly samples: number }>;
}

// ─────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────

const ZERO_ROLLUP: SemanticCacheRollup = Object.freeze({
  totalLookups: 0,
  hits: 0,
  misses: 0,
  skips: 0,
  hitRate: 0,
  costSavedUsdMicros: 0,
  costSpentUsdMicros: 0,
});

const VALID_OUTCOMES: ReadonlySet<SemanticCacheOutcome> = new Set([
  'hit',
  'miss',
  'skip',
]);

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createSemanticCacheLogService(
  db: DatabaseClient,
): SemanticCacheLogService {
  return {
    async record(args) {
      if (!VALID_OUTCOMES.has(args.outcome)) {
        logger.warn('semantic-cache-log: invalid outcome rejected', { value: args.outcome });
        return null;
      }
      const id = randomUUID();
      try {
        await db.insert(semanticCacheLog).values({
          id,
          tenantId: args.tenantId,
          surface: args.surface,
          personaId: args.personaId,
          outcome: args.outcome,
          intent: args.intent,
          similarity: args.similarity,
          threshold: args.threshold,
          modelId: args.modelId,
          costUsdMicros: args.costUsdMicros,
          promptTokens: args.promptTokens,
          completionTokens: args.completionTokens,
          skipReason: args.skipReason,
          occurredAt: new Date(args.occurredAt),
        });
        return { id };
      } catch (err) {
        // Side-channel — log + swallow. Never break the user turn.
        logger.warn('semantic-cache-log: record failed', { value: err instanceof Error ? err.message : String(err) });
        return null;
      }
    },

    async rollupForTenant(args) {
      const sinceDays = Math.max(1, Math.floor(args.sinceDays || 1));
      const cutoff = new Date(Date.now() - sinceDays * 86_400_000);
      try {
        const tenantPredicate =
          args.tenantId === null
            ? isNull(semanticCacheLog.tenantId)
            : eq(semanticCacheLog.tenantId, args.tenantId);
        const rows = await db
          .select({
            outcome: semanticCacheLog.outcome,
            count: sql<number>`count(*)::int`,
            cost: sql<number>`coalesce(sum(${semanticCacheLog.costUsdMicros}), 0)::bigint`,
          })
          .from(semanticCacheLog)
          .where(
            and(tenantPredicate, gte(semanticCacheLog.occurredAt, cutoff)),
          )
          .groupBy(semanticCacheLog.outcome);
        return buildRollup(rows);
      } catch (err) {
        logger.warn('semantic-cache-log: rollupForTenant failed', { value: err instanceof Error ? err.message : String(err) });
        return ZERO_ROLLUP;
      }
    },

    async hitRateForTenant(args) {
      const r = await this.rollupForTenant(args);
      return {
        hitRate: r.hitRate,
        samples: r.hits + r.misses,
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

interface OutcomeRow {
  readonly outcome: string;
  readonly count: number;
  readonly cost: number | bigint;
}

function buildRollup(rows: ReadonlyArray<OutcomeRow>): SemanticCacheRollup {
  let hits = 0;
  let misses = 0;
  let skips = 0;
  let saved = 0;
  let spent = 0;
  for (const row of rows) {
    const count = Number(row.count) || 0;
    const cost = Number(row.cost) || 0;
    if (row.outcome === 'hit') {
      hits += count;
      saved += cost;
    } else if (row.outcome === 'miss') {
      misses += count;
      spent += cost;
    } else if (row.outcome === 'skip') {
      skips += count;
    }
  }
  const denom = hits + misses;
  return {
    totalLookups: hits + misses + skips,
    hits,
    misses,
    skips,
    hitRate: denom > 0 ? hits / denom : 0,
    costSavedUsdMicros: saved,
    costSpentUsdMicros: spent,
  };
}

// Re-export for test access — keeps `isNotNull` import non-tree-shaken
// so future role-filter additions don't churn imports.
export { isNotNull };
