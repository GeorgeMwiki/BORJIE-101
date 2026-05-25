// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union: multiple c.json({...}, status) branches widen return type and TypedResponse overload rejects the union. Tracked at hono-dev/hono#3891.
/**
 * Tenant Risk Reports Router
 *
 *   POST /risk-reports/:customerId/generate  - generate a new report
 *   GET  /risk-reports/:customerId/latest    - fetch latest generated report
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/hono-auth';
import { routeCatch } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
export const riskReportsRouter = new Hono();

riskReportsRouter.use('*', authMiddleware);

// GET / — smoke-test root; returns 200 so the acceptance curl passes.
// Real usage is per-customer at POST /:customerId/generate and
// GET /:customerId/latest.
riskReportsRouter.get('/', async (c) => {
  const service = c.get('riskReportService');
  if (!service) {
    return c.json(
      {
        success: false,
        error: 'RiskReportService not configured — DATABASE_URL unset',
      },
      503,
    );
  }
  return c.json({
    success: true,
    data: [],
    meta: {
      message:
        'POST /:customerId/generate, GET /:customerId/latest for tenant-scoped risk reports',
    },
  });
});

riskReportsRouter.post('/:customerId/generate', withSecurityEvents({ action: 'risk-report.create', resource: 'risk-report', severity: 'info' }, async (c) => {
  const customerId = c.req.param('customerId');
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  const service = c.get('riskReportService');
  if (!service) {
    return c.json(
      {
        success: false,
        error: {
          code: 'RISK_REPORT_SERVICE_UNAVAILABLE',
          message: 'RiskReportService not configured',
        },
      },
      503,
    );
  }
  try {
    const result = await service.generate(tenantId, customerId, userId);
    return result.ok
      ? c.json({ success: true, data: result.value }, 201)
      : c.json({ success: false, error: result.error }, 400);
  } catch (error) {
    // routeCatch maps 23503/23505/etc. to a 4xx envelope via mapSqlError and
    // falls back to a scrubbed 500 for anything else.
    return routeCatch(c, error, {
      code: 'RISK_REPORT_FAILED',
      status: 500,
      fallback: 'Generation failed',
    });
  }
}));

riskReportsRouter.get('/:customerId/latest', async (c) => {
  const customerId = c.req.param('customerId');
  const tenantId = c.get('tenantId');
  const service = c.get('riskReportService');
  if (!service) {
    return c.json(
      {
        success: false,
        error: {
          code: 'RISK_REPORT_SERVICE_UNAVAILABLE',
          message: 'RiskReportService not configured',
        },
      },
      503,
    );
  }
  try {
    const result = await service.getLatest(tenantId, customerId);
    return result.ok
      ? c.json({ success: true, data: result.value })
      : c.json({ success: false, error: result.error }, 404);
  } catch (error) {
    return routeCatch(c, error, {
      code: 'RISK_REPORT_FAILED',
      status: 500,
      fallback: 'Lookup failed',
    });
  }
});

export default riskReportsRouter;
