/**
 * /api/v1/analytics/growth — owner-portal AnalyticsGrowthPage.
 *
 * WS-4: now serves a REAL monthly growth series from the
 * `analytics_growth_monthly` warehouse (migration 0176), populated by the
 * consolidation-worker analytics-aggregate task from the mining domain
 * (sites → production_records → sales → ledger_entries). The previous
 * `X-Backend-Status: degraded` skeleton is gone.
 *
 * The read runs on the RLS-pinned request client (`c.get('db')`), so tenant
 * isolation is enforced by FORCE row-level security. Each point carries an
 * ISO-4217 `currency` so the renderer threads it into
 * `formatCurrency(amount, code)` — money is NEVER hardcoded. The series is
 * `{ period, activeSites, productionKg, salesCount, revenueMinorUnits,
 * royaltyMinorUnits, currency }[]`, newest month first.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { growthSeries } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { requireRole } from '../../middleware/authorization';
import { UserRole } from '../../types/user-role';
import { resolveRange } from './analytics-range';

const QuerySchema = z.object({
  range: z.enum(['30d', '90d', '12m']).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);
app.use(
  '*',
  requireRole(
    UserRole.OWNER,
    UserRole.TENANT_ADMIN,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
  ),
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.get('/', async (c: any) => {
  const { tenantId } = c.get('auth');
  const parsed = QuerySchema.safeParse({
    range: c.req.query('range'),
    limit: c.req.query('limit'),
  });
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters' },
      },
      400,
    );
  }

  const db = c.get('db');
  const range = resolveRange(parsed.data.range);
  const series = await growthSeries(db, tenantId, {
    range,
    limit: parsed.data.limit,
  });

  return c.json(
    { success: true as const, data: series, meta: { tenantId, count: series.length } },
    200,
  );
});

export const analyticsGrowthRouter = app;
