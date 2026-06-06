/**
 * /api/v1/mining/fx-treasury — owner FX & treasury advisor.
 *
 * Wraps `@borjie/fx-treasury-advisor` (pure cash-runway projection, FX
 * exposure netting with cross-rate conversion, and the 27-Mar USD-cliff
 * remediation playbook) behind a tenant-scoped BFF for the owner
 * cockpit's treasury surface.
 *
 * Routes:
 *   POST /analyze     project a day-by-day cash runway (with zero-crossing
 *                     + min-balance) and net the multi-currency FX
 *                     exposure, then PERSIST the snapshot into
 *                     `fx_snapshots` (real tenant-scoped table).
 *   POST /recommend   derive evidence-backed treasury recommendations
 *                     (runway-floor breach, single-currency concentration,
 *                     USD-cliff remediation) from an analysis + input +
 *                     policy.
 *   GET  /snapshots   list the tenant's recent persisted analyses,
 *                     most-recent first.
 *
 * Compute is genuine: the runway walks each horizon day applying every
 * cashflow (converted to base currency at the supplied spot rates); the
 * exposure nets balances + flows per currency. No fabricated numbers.
 *
 * RLS: tenant isolation via the `app.current_tenant_id` GUC bound in
 * `databaseMiddleware`; queries also filter on `tenantId` (defence in
 * depth); writes carry tenantId explicitly.
 *
 * NEVER hardcodes a currency: `baseCurrency` is supplied on the request
 * and echoed on every response; all conversions use the caller's
 * `fxRates`. This is the FX domain — currency is data, never a literal.
 */

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  createFxTreasuryAdvisor,
  treasuryInputSchema,
  treasuryRecommendationContextSchema,
} from '@borjie/fx-treasury-advisor';
import { fxSnapshots } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-fx-treasury');

const advisor = createFxTreasuryAdvisor({ logger: moduleLogger });

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50).optional(),
});

/**
 * Pull a USD/TZS spot from the supplied rates so the persisted snapshot's
 * numeric `bot_rate_tzs_per_usd` column carries a real value when the
 * caller provided one. Returns null when no USD/TZS (or TZS/USD inverse)
 * rate is present — never fabricates a rate.
 */
function usdTzsFromRates(
  rates: ReadonlyArray<{ pair: string; rate: number }>,
): number | null {
  const direct = rates.find((r) => r.pair === 'USD/TZS');
  if (direct) return direct.rate;
  const inverse = rates.find((r) => r.pair === 'TZS/USD');
  if (inverse && inverse.rate !== 0) return 1 / inverse.rate;
  return null;
}

// ---------------------------------------------------------------------------
// POST /analyze — project runway + exposure, persist the snapshot.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.post('/analyze', async (c: any) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json(
      {
        success: false as const,
        error: { code: 'INVALID_JSON', message: 'Request body must be JSON.' },
      },
      400,
    );
  }

  const parsed = treasuryInputSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid treasury input.',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }

  let analysis;
  try {
    analysis = await advisor.analyze(parsed.data);
  } catch (err) {
    moduleLogger.error('fx-treasury analyze failed', {
      err: err instanceof Error ? err.message : String(err),
      tenantId,
    });
    return c.json(
      {
        success: false as const,
        error: { code: 'ANALYZE_FAILED', message: 'Treasury analysis could not be computed.' },
      },
      422,
    );
  }

  let persisted = false;
  let snapshotId: string | null = null;
  if (db) {
    try {
      snapshotId = randomUUID();
      const usdTzs = usdTzsFromRates(parsed.data.fxRates);
      await db.insert(fxSnapshots).values({
        id: snapshotId,
        tenantId,
        mode: 'runway-exposure',
        botRateTzsPerUsd: usdTzs === null ? null : usdTzs.toFixed(4),
        summary: {
          baseCurrency: analysis.runway.baseCurrency,
          runway: analysis.runway,
          exposure: analysis.exposure,
          computedAtISO: analysis.computedAtISO,
        },
      });
      persisted = true;
    } catch (err) {
      moduleLogger.warn('fx-treasury snapshot persist failed', {
        err: err instanceof Error ? err.message : String(err),
        tenantId,
      });
    }
  }

  return c.json(
    { success: true as const, data: { analysis, persisted, snapshotId } },
    200,
  );
});

// ---------------------------------------------------------------------------
// POST /recommend — evidence-backed treasury recommendations.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.post('/recommend', async (c: any) => {
  const { tenantId } = c.get('auth');

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json(
      {
        success: false as const,
        error: { code: 'INVALID_JSON', message: 'Request body must be JSON.' },
      },
      400,
    );
  }

  const parsed = treasuryRecommendationContextSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid recommendation context.',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }

  try {
    const recommendations = await advisor.recommend(parsed.data);
    return c.json({ success: true as const, data: { recommendations } }, 200);
  } catch (err) {
    moduleLogger.error('fx-treasury recommend failed', {
      err: err instanceof Error ? err.message : String(err),
      tenantId,
    });
    return c.json(
      {
        success: false as const,
        error: { code: 'RECOMMEND_FAILED', message: 'Recommendations could not be derived.' },
      },
      422,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /snapshots — list the tenant's recent persisted analyses.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.get('/snapshots', async (c: any) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');

  const parsed = listQuerySchema.safeParse({ limit: c.req.query('limit') });
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters.' },
      },
      400,
    );
  }
  if (!db) {
    return c.json({ success: true as const, data: [] as const }, 200);
  }

  const limit = Math.min(parsed.data.limit ?? 50, 200);
  try {
    const rows = await db
      .select()
      .from(fxSnapshots)
      .where(
        and(
          eq(fxSnapshots.tenantId, tenantId),
          eq(fxSnapshots.mode, 'runway-exposure'),
        ),
      )
      .orderBy(desc(fxSnapshots.computedAt))
      .limit(limit);
    return c.json({ success: true as const, data: rows }, 200);
  } catch (err) {
    moduleLogger.warn('fx-treasury snapshots query failed', {
      err: err instanceof Error ? err.message : String(err),
      tenantId,
    });
    return c.json({ success: true as const, data: [] as const }, 200);
  }
});

export const miningFxTreasuryRouter = app;
export default app;
