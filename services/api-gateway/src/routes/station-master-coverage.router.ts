/**
 * Station Master Coverage API Routes (NEW 18)
 *
 *   GET /                         → list coverage rows for the tenant
 *   PUT /:id/coverage             → replace the coverage set for a station master
 *
 * Wired to `PostgresStationMasterCoverageRepository` via the composition
 * root. When DATABASE_URL is unset the repo is null and the routes fall
 * back to 503 with a clear reason.
 */

// @ts-nocheck — Hono context types are open-ended by design in this project.

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth';

import { withSecurityEvents } from '@borjie/observability';
const app = new Hono();
app.use('*', authMiddleware);

const CoverageItemSchema = z.object({
  kind: z.enum(['tag', 'polygon', 'city', 'property_ids', 'region']),
  value: z.record(z.unknown()),
  priority: z.number().int().nonnegative().default(100),
});

const PutCoverageBodySchema = z.object({
  coverages: z.array(CoverageItemSchema).max(200),
});

function notConfigured(c: any) {
  return c.json(
    {
      success: false,
      error:
        'StationMasterCoverageRepository not configured — DATABASE_URL unset',
    },
    503
  );
}

// GET / — list all coverage rows for the current tenant.
app.get('/', async (c: any) => {
  const repo = c.get('stationMasterCoverageRepo');
  if (!repo) return notConfigured(c);
  const tenantId = c.get('tenantId');
  const rows = await repo.list(tenantId);
  return c.json({ success: true, data: rows });
});

app.put(
  '/:id/coverage',
  zValidator('json', PutCoverageBodySchema),
  withSecurityEvents({ action: 'station-master-coverage.update', resource: 'station-master-coverage', severity: 'info' }, async (c: any) => {
    const repo = c.get('stationMasterCoverageRepo');
    if (!repo) return notConfigured(c);
    const tenantId = c.get('tenantId');
    const updatedBy = c.get('userId');
    const stationMasterId = c.req.param('id');
    const body = c.req.valid('json');
    await repo.putForStationMaster({
      tenantId,
      stationMasterId,
      coverages: body.coverages.map((item: { kind: string; value: Record<string, unknown>; priority: number }) => ({
        coverage: { kind: item.kind, value: item.value },
        priority: item.priority,
      })),
      updatedBy,
    });
    return c.json({ success: true });
  })
);

export default app;
