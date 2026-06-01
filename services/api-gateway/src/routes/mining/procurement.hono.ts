/**
 * /api/v1/mining/procurement — procurement read surface.
 *
 * Routes:
 *   GET   /recommendations   list the tenant's procurement recommendations
 *
 * Backs the owner-os Procurement panel. Reads
 * `procurement_recommendations` (junior-outputs/commercial) — the
 * tenant-scoped record produced by the procurement junior. A first-class
 * supplier / purchase-order ledger is not yet modelled; until it lands
 * this is the real, non-fabricated procurement slice the panel surfaces.
 *
 * Tenant isolation is provided by the RLS GUC bound in
 * `databaseMiddleware`; queries also pass `tenantId` defensively into
 * every where-clause (defence in depth).
 */

import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { procurementRecommendations } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

const ListRecommendationsQuerySchema = z.object({
  siteId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100).optional(),
});

// ---------------------------------------------------------------------------
// GET /recommendations — list procurement recommendations for the tenant.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.get('/recommendations', async (c: any) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const parsed = ListRecommendationsQuerySchema.safeParse({
    siteId: c.req.query('siteId'),
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
  if (!db) {
    return c.json({ success: true as const, data: [] as const }, 200);
  }
  const limit = Math.min(parsed.data.limit ?? 100, 500);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conds: any[] = [eq(procurementRecommendations.tenantId, tenantId)];
  if (parsed.data.siteId) {
    conds.push(eq(procurementRecommendations.siteId, parsed.data.siteId));
  }
  const rows = await db
    .select()
    .from(procurementRecommendations)
    .where(and(...conds))
    .orderBy(desc(procurementRecommendations.createdAt))
    .limit(limit);
  return c.json({ success: true as const, data: rows }, 200);
});

export const miningProcurementRouter = app;
export default app;
