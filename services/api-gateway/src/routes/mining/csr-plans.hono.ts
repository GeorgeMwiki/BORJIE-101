/**
 * /api/v1/mining/csr-plans — Corporate Social Responsibility commitments.
 *
 * Routes:
 *   GET   /     list CSR plans with derived delivered_pct (migration 0082)
 *
 * Reads `csr_plans` (safety-csr.schema). The derived `delivered_pct`
 * column is GENERATED ALWAYS AS in migration 0082; this route exposes
 * it under the canonical mining path the mobile clients expect.
 *
 * Tenant isolation is provided by the RLS GUC; queries also pass
 * `tenantId` defensively to every where-clause.
 */

import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { csrPlans } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

const ListCsrPlansQuerySchema = z.object({
  status: z
    .enum(['draft', 'approved', 'in_progress', 'completed', 'cancelled'])
    .optional(),
  category: z.string().optional(),
  siteId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100).optional(),
});

// ---------------------------------------------------------------------------
// GET / — list CSR plans for the tenant.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.get('/', async (c: any) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const rawQuery = {
    status: c.req.query('status'),
    category: c.req.query('category'),
    siteId: c.req.query('siteId'),
    limit: c.req.query('limit'),
  };
  const parsed = ListCsrPlansQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
        },
      },
      400,
    );
  }
  if (!db) {
    return c.json({ success: true as const, data: [] as const }, 200);
  }
  const limit = Math.min(parsed.data.limit ?? 100, 500);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conds: any[] = [eq(csrPlans.tenantId, tenantId)];
  if (parsed.data.status) {
    conds.push(eq(csrPlans.status, parsed.data.status));
  }
  if (parsed.data.category) {
    conds.push(eq(csrPlans.category, parsed.data.category));
  }
  if (parsed.data.siteId) {
    conds.push(eq(csrPlans.siteId, parsed.data.siteId));
  }
  const rows = await db
    .select()
    .from(csrPlans)
    .where(and(...conds))
    .orderBy(desc(csrPlans.createdAt))
    .limit(limit);
  return c.json({ success: true as const, data: rows }, 200);
});

export const miningCsrPlansRouter = app;
export default app;
