/**
 * /api/v1/mining/cost-engineer — owner cost-engineering advisor.
 *
 * Wraps `@borjie/cost-engineer-advisor` (pure analytic core: P&L, unit
 * economics, price/fuel sensitivity tables, evidence-backed
 * recommendations) behind a tenant-scoped BFF for the owner cockpit's
 * finance surface.
 *
 * Routes:
 *   POST /analyze     compute a P&L + unit-economics + sensitivity table
 *                     from a production-period input, and PERSIST the
 *                     derived snapshot into `unit_economics_snapshots`
 *                     (real tenant-scoped junior-output table).
 *   POST /recommend   derive evidence-backed cost recommendations from a
 *                     previously-computed analysis + caller benchmarks.
 *   GET  /snapshots   list the tenant's recent persisted analyses
 *                     (most-recent first), backing the panel's history.
 *
 * Compute is genuine (no fabrication): every number is derived from the
 * caller's production figures by the advisor's pure functions.
 *
 * RLS: tenant isolation is enforced by the `app.current_tenant_id` GUC
 * bound in `databaseMiddleware`; every query ALSO filters on `tenantId`
 * defensively (defence in depth). Writes carry the tenantId explicitly.
 *
 * Evidence-required: each recommendation carries a non-empty `evidence`
 * array (the advisor's schema rejects empty chains), so the owner sees
 * the pointer behind every suggestion.
 *
 * NO new currency hardcoding: the currency travels on the request body
 * (`CurrencyCode`) and is echoed back on every response. The treatment
 * of money is done in the caller's currency end-to-end.
 */

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  createCostEngineerAdvisor,
  costAnalyzeInputSchema,
  recommendationContextSchema,
} from '@borjie/cost-engineer-advisor';
import { unitEconomicsSnapshots } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-cost-engineer');

const advisor = createCostEngineerAdvisor({ logger: moduleLogger });

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// The analyze body extends the advisor's canonical input with an
// optional `siteId` so persisted snapshots can be scoped to a site.
const analyzeBodySchema = costAnalyzeInputSchema.extend({
  siteId: z.string().min(1).optional(),
});

const listQuerySchema = z.object({
  siteId: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50).optional(),
});

// ---------------------------------------------------------------------------
// POST /analyze — compute + persist a cost analysis for the tenant.
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

  const parsed = analyzeBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid cost-analysis input.',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }

  const { siteId, ...analyzeInput } = parsed.data;

  let analysis;
  try {
    analysis = await advisor.analyze(analyzeInput);
  } catch (err) {
    moduleLogger.error('cost-engineer analyze failed', {
      err: err instanceof Error ? err.message : String(err),
      tenantId,
    });
    return c.json(
      {
        success: false as const,
        error: { code: 'ANALYZE_FAILED', message: 'Cost analysis could not be computed.' },
      },
      422,
    );
  }

  // Persist the derived snapshot (real tenant-scoped table). A write
  // failure must not lose the computed result for the caller, so we log
  // and still return the analysis with `persisted: false`.
  let persisted = false;
  let snapshotId: string | null = null;
  if (db) {
    try {
      snapshotId = randomUUID();
      await db.insert(unitEconomicsSnapshots).values({
        id: snapshotId,
        tenantId,
        siteId: siteId ?? null,
        period: analysis.period.periodLabel,
        summary: {
          currency: analysis.currency,
          pnl: analysis.pnl,
          unit: analysis.unit,
          sensitivity: analysis.sensitivity,
          computedAtISO: analysis.computedAtISO,
        },
      });
      persisted = true;
    } catch (err) {
      moduleLogger.warn('cost-engineer snapshot persist failed', {
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
// POST /recommend — evidence-backed cost recommendations from an analysis.
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

  const parsed = recommendationContextSchema.safeParse(raw);
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
    moduleLogger.error('cost-engineer recommend failed', {
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

  const parsed = listQuerySchema.safeParse({
    siteId: c.req.query('siteId'),
    limit: c.req.query('limit'),
  });
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conds: any[] = [eq(unitEconomicsSnapshots.tenantId, tenantId)];
  if (parsed.data.siteId) {
    conds.push(eq(unitEconomicsSnapshots.siteId, parsed.data.siteId));
  }

  try {
    const rows = await db
      .select()
      .from(unitEconomicsSnapshots)
      .where(and(...conds))
      .orderBy(desc(unitEconomicsSnapshots.computedAt))
      .limit(limit);
    return c.json({ success: true as const, data: rows }, 200);
  } catch (err) {
    moduleLogger.warn('cost-engineer snapshots query failed', {
      err: err instanceof Error ? err.message : String(err),
      tenantId,
    });
    return c.json({ success: true as const, data: [] as const }, 200);
  }
});

export const miningCostEngineerRouter = app;
export default app;
