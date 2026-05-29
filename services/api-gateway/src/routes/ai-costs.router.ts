/**
 * AI costs router — Wave 9 enterprise polish.
 *
 * Mounted at `/api/v1/ai-costs`.
 *
 *   GET /ai-costs/summary   — current-month spend + per-model breakdown
 *   GET /ai-costs/entries   — recent LLM call entries (append-only)
 *   GET /ai-costs/budget    — caller's tenant budget (null if unset)
 *   PUT /ai-costs/budget    — admin sets monthly cap
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';
import { routeCatch } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
const SetBudgetSchema = z.object({
  monthlyCapUsdMicro: z.number().int().nonnegative(),
  hardStop: z.boolean().optional(),
});

const app = new Hono();
app.use('*', authMiddleware);

function ledger(c: any) {
  const services = c.get('services') ?? {};
  return services.aiCostLedger;
}

function notImplemented(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'AI cost ledger not wired into api-gateway context',
      },
    },
    503,
  );
}

// Borjie hard-fork: the `ai_cost_*` tables ship in a migration that
// hasn't been applied to every dev DB. Routing every `catch` through
// `routeCatch` lets a missing-table failure surface as 503
// `TABLE_NOT_PROVISIONED` instead of `INTERNAL_ERROR` 500.
function handleAiCostError(c: any, e: unknown) {
  return routeCatch(c, e, { code: 'AI_COSTS_QUERY_FAILED' });
}

function mapError(e: unknown) {
  const err = e as { code?: string; message?: string } | undefined;
  const code = err?.code ?? 'INTERNAL_ERROR';
  const status =
    code === 'VALIDATION' ? 400 : code === 'NOT_FOUND' ? 404 : 500;
  return {
    body: {
      success: false,
      error: { code, message: err?.message ?? 'unknown' },
    },
    status,
  };
}

app.get('/summary', async (c: any) => {
  const auth = c.get('auth');
  const l = ledger(c);
  if (!l) return notImplemented(c);
  try {
    const [summary, budget] = await Promise.all([
      l.currentMonthSpend(auth.tenantId),
      l.getBudget(auth.tenantId),
    ]);
    const overBudget =
      budget && budget.hardStop && budget.monthlyCapUsdMicro > 0
        ? summary.totalCostUsdMicro >= budget.monthlyCapUsdMicro
        : false;
    return c.json({
      success: true,
      data: { summary, budget, overBudget },
    });
  } catch (e: unknown) {
    return handleAiCostError(c, e);
  }
});

app.get('/entries', async (c: any) => {
  const auth = c.get('auth');
  const l = ledger(c);
  if (!l) return notImplemented(c);
  const limitParam = c.req.query('limit');
  const limit = limitParam ? Math.min(500, Math.max(1, Number(limitParam))) : 50;
  try {
    const entries = await l.listRecentEntries(auth.tenantId, limit);
    return c.json({ success: true, data: entries });
  } catch (e: unknown) {
    return handleAiCostError(c, e);
  }
});

app.get('/budget', async (c: any) => {
  const auth = c.get('auth');
  const l = ledger(c);
  if (!l) return notImplemented(c);
  try {
    const budget = await l.getBudget(auth.tenantId);
    return c.json({ success: true, data: budget });
  } catch (e: unknown) {
    return handleAiCostError(c, e);
  }
});

app.put(
  '/budget',
  requireRole(
    UserRole.TENANT_ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
  ),
  zValidator('json', SetBudgetSchema),
  withSecurityEvents({ action: 'ai-cost.update', resource: 'ai-cost', severity: 'info' }, async (c: any) => {
    const auth = c.get('auth');
    const body = c.req.valid('json');
    const l = ledger(c);
    if (!l) return notImplemented(c);
    try {
      const saved = await l.setBudget(auth.tenantId, body.monthlyCapUsdMicro, {
        hardStop: body.hardStop,
        updatedBy: auth.userId,
      });
      return c.json({ success: true, data: saved });
    } catch (e: unknown) {
      return handleAiCostError(c, e);
    }
  }),
);

export const aiCostsRouter = app;
export default app;
