/**
 * /api/v1/mining/internal/models — HQ AI-model spend overview (AD-3).
 *
 * SUPER_ADMIN / ADMIN only. Aggregates the REAL `ai_cost_entries` ledger
 * (one append-only row per LLM call) into a per-model rollup:
 *
 *   GET /   → [{ provider, model, calls, inputTokens, outputTokens,
 *               costUsd, lastUsedAt }]  over a bounded window.
 *
 * This is genuinely real data — NO fabricated per-junior model assignments
 * and NO invented p50 latency. Those two fields the admin-web `models`
 * page also wants are NOT columns on any table today, so they are
 * deliberately omitted here (see the agent report's "honest-pending"
 * flags). Reporting real spend without them is honest; inventing them
 * would not be.
 *
 * Cross-tenant fleet view (mirrors tenants.hono.ts): platform-admin role
 * required; the rollup spans every tenant's calls. Costs are stored as
 * BIGINT microdollars and surfaced as a USD number — currency is fixed by
 * the ledger's own unit (provider billing is USD), NOT a money-render of a
 * tenant contract, so this is not a hard-coded TZS/USD violation.
 *
 * Per CLAUDE.md: parameterised `db.execute(sql)` (no interpolation),
 * Pino logger only, immutable projections.
 */

import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';
import { createLogger } from '../../../utils/logger';

const moduleLogger = createLogger('admin-models-overview');

const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 180;

interface ModelRollupRow {
  readonly provider: string;
  readonly model: string;
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly lastUsedAt: string | null;
}

function rowsOf(raw: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as ReadonlyArray<Record<string, unknown>>;
  if (raw && typeof raw === 'object' && 'rows' in raw) {
    const r = (raw as { rows: unknown }).rows;
    if (Array.isArray(r)) return r as ReadonlyArray<Record<string, unknown>>;
  }
  return [];
}

function toNum(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function createMiningInternalModelsRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
  app.use('*', databaseMiddleware);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.get('/', async (c: any) => {
    const db = c.get('db') as { execute(q: unknown): Promise<unknown> } | null;
    if (!db) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'MODELS_OVERVIEW_UNAVAILABLE',
            message: 'database is not configured on this gateway',
          },
        },
        503,
      );
    }
    const windowRaw = Number(c.req.query('windowDays') ?? DEFAULT_WINDOW_DAYS);
    const windowDays = Math.max(
      1,
      Math.min(MAX_WINDOW_DAYS, Math.floor(windowRaw || DEFAULT_WINDOW_DAYS)),
    );

    try {
      const rows = rowsOf(
        await db.execute(sql`
          SELECT provider,
                 model,
                 count(*)::int            AS calls,
                 sum(input_tokens)::bigint  AS input_tokens,
                 sum(output_tokens)::bigint AS output_tokens,
                 sum(cost_usd_micro)::bigint AS cost_usd_micro,
                 max(occurred_at)         AS last_used_at
            FROM ai_cost_entries
           WHERE occurred_at >= NOW() - (${windowDays}::int * INTERVAL '1 day')
           GROUP BY provider, model
           ORDER BY sum(cost_usd_micro) DESC
           LIMIT 200
        `),
      );
      const data: ReadonlyArray<ModelRollupRow> = rows.map((r) => ({
        provider: String(r.provider ?? ''),
        model: String(r.model ?? ''),
        calls: toNum(r.calls),
        inputTokens: toNum(r.input_tokens),
        outputTokens: toNum(r.output_tokens),
        // microdollars → USD; integer-safe division at the boundary.
        costUsd: toNum(r.cost_usd_micro) / 1_000_000,
        lastUsedAt:
          r.last_used_at instanceof Date
            ? r.last_used_at.toISOString()
            : r.last_used_at == null
              ? null
              : String(r.last_used_at),
      }));
      return c.json(
        {
          success: true as const,
          data,
          meta: { windowDays, source: 'ai_cost_entries' as const },
        },
        200,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      moduleLogger.error('models overview failed', {
        evt: 'admin_models_overview_failed',
        reason,
      });
      return c.json(
        {
          success: false as const,
          error: { code: 'MODELS_OVERVIEW_FAILED', message: reason },
        },
        500,
      );
    }
  });

  return app;
}

export const miningInternalModelsRouter = createMiningInternalModelsRouter();
export default miningInternalModelsRouter;
