/**
 * /api/v1/mining/esg — ESG community-engagement read surface.
 *
 * Routes:
 *   GET   /community   list minuted village (community) meetings
 *
 * Backs the owner-os ESG panel. Reads `village_meetings`
 * (safety-csr.schema) — the auditable record of community engagement
 * required for Local Content + community-benefit reporting. Emissions
 * and reclamation slices land on this same prefix as their domain
 * surfaces mature; today the community-engagement log is the live,
 * non-fabricated slice.
 *
 * Tenant isolation is provided by the RLS GUC bound in
 * `databaseMiddleware`; queries also pass `tenantId` defensively into
 * every where-clause (defence in depth).
 */

import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { villageMeetings } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

const ListCommunityQuerySchema = z.object({
  status: z.enum(['scheduled', 'held', 'cancelled', 'deferred']).optional(),
  siteId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100).optional(),
});

// ---------------------------------------------------------------------------
// GET /community — list community (village) meetings for the tenant.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.get('/community', async (c: any) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const parsed = ListCommunityQuerySchema.safeParse({
    status: c.req.query('status'),
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
  const conds: any[] = [eq(villageMeetings.tenantId, tenantId)];
  if (parsed.data.status) {
    conds.push(eq(villageMeetings.status, parsed.data.status));
  }
  if (parsed.data.siteId) {
    conds.push(eq(villageMeetings.siteId, parsed.data.siteId));
  }
  const rows = await db
    .select()
    .from(villageMeetings)
    .where(and(...conds))
    .orderBy(desc(villageMeetings.meetingDate))
    .limit(limit);
  return c.json({ success: true as const, data: rows }, 200);
});

export const miningEsgRouter = app;
export default app;
