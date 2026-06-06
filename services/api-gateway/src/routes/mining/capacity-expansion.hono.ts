/**
 * /api/v1/mining/capacity-expansion — NPV / IRR / payback advisor (OW-?).
 *
 * Wraps the REAL pure-compute `@borjie/capacity-expansion-advisor`
 * package (deterministic NPV, bisection IRR, interpolated payback across
 * named expansion scenarios, ranked by NPV; evidence-cited
 * recommendations gated by a policy floor). NO new tables, NO migrations
 * — the advisor is a stateless financial solver.
 *
 * Routes:
 *   POST /analyze    score every supplied scenario → outcomes (npv / irr /
 *                    payback / incremental tonnes) + NPV ranking.
 *   POST /recommend  derive evidence-cited recommendations from an
 *                    analysis + optional policy floor (minNpv /
 *                    maxPaybackYears).
 *
 * EVIDENCE: every recommendation the advisor returns cites >=1 evidence
 * ref (the scenario it was derived from), satisfying the evidence-required
 * AI-output rule. Currency is caller-supplied (TZS|USD|EUR|GBP) and echoed
 * back — no currency is hard-coded in this route.
 *
 * RLS: authMiddleware + databaseMiddleware bind app.current_tenant_id.
 * This route performs NO tenant-table reads (the advisor is pure compute
 * over the request body), but it still runs behind auth so only a
 * signed-in tenant member can use the solver, and the middleware keeps
 * the request consistent with every other mining route.
 */

import { Hono } from 'hono';

import {
  createCapacityExpansionAdvisor,
  expansionAnalyzeInputSchema,
  expansionRecommendationContextSchema,
} from '@borjie/capacity-expansion-advisor';

import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-capacity-expansion');

export const miningCapacityExpansionRouter = new Hono();
miningCapacityExpansionRouter.use('*', authMiddleware);
miningCapacityExpansionRouter.use('*', databaseMiddleware);

// Shared advisor instance — pure + stateless, safe to reuse. Package
// structured events flow through the gateway Pino logger (no console.log).
const advisor = createCapacityExpansionAdvisor({
  logger: {
    info: (msg, meta) => moduleLogger.info(meta ?? {}, msg),
    warn: (msg, meta) => moduleLogger.warn(meta ?? {}, msg),
    error: (msg, meta) => moduleLogger.error(meta ?? {}, msg),
  },
});

// ---------------------------------------------------------------------------
// POST /analyze — score + rank expansion scenarios.
// ---------------------------------------------------------------------------
miningCapacityExpansionRouter.post('/analyze', async (c) => {
  const auth = c.get('auth') as { tenantId?: string };
  if (!auth?.tenantId) {
    return c.json(
      { success: false as const, error: { code: 'CAPACITY_UNAUTHENTICATED' } },
      401,
    );
  }

  const raw = await c.req.json().catch(() => ({}));
  const parsed = expansionAnalyzeInputSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: { code: 'INVALID_BODY', issues: parsed.error.issues },
      },
      400,
    );
  }

  try {
    const analysis = await advisor.analyze(parsed.data);
    return c.json({ success: true as const, data: { analysis } }, 200);
  } catch (err) {
    moduleLogger.error(
      { err, tenantId: auth.tenantId },
      'capacity_analyze_failed',
    );
    return c.json(
      { success: false as const, error: { code: 'CAPACITY_ANALYZE_FAILED' } },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /recommend — evidence-cited recommendations from an analysis.
// ---------------------------------------------------------------------------
miningCapacityExpansionRouter.post('/recommend', async (c) => {
  const auth = c.get('auth') as { tenantId?: string };
  if (!auth?.tenantId) {
    return c.json(
      { success: false as const, error: { code: 'CAPACITY_UNAUTHENTICATED' } },
      401,
    );
  }

  const raw = await c.req.json().catch(() => ({}));
  const parsed = expansionRecommendationContextSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: { code: 'INVALID_BODY', issues: parsed.error.issues },
      },
      400,
    );
  }

  try {
    const recommendations = await advisor.recommend(parsed.data);
    return c.json(
      {
        success: true as const,
        data: {
          recommendations,
          count: recommendations.length,
        },
      },
      200,
    );
  } catch (err) {
    moduleLogger.error(
      { err, tenantId: auth.tenantId },
      'capacity_recommend_failed',
    );
    return c.json(
      { success: false as const, error: { code: 'CAPACITY_RECOMMEND_FAILED' } },
      500,
    );
  }
});

export default miningCapacityExpansionRouter;
