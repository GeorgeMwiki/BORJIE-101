/**
 * /api/v1/mining/ancillary — ancillary (side-business) read surface
 * (empty contract).
 *
 * Routes:
 *   GET   /businesses   list ancillary businesses for the tenant
 *
 * DOMAIN TABLE STILL NEEDED. There is no `ancillary_business` /
 * `side_business` table in `packages/database/src/schemas` yet (ancillary
 * ventures are not modelled as estate entities today). Until that domain
 * table lands, this route returns a real, non-fabricated empty list
 * (200, []) so the panel renders a proper "no records yet" state (NOT a
 * dead CTA). Wire the real query the day the ancillary-business table
 * ships.
 *
 * The endpoint is authed + RLS-bound (GUC via `databaseMiddleware`) so
 * the surface contract is honoured today.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

const ListBusinessesQuerySchema = z.object({
  status: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100).optional(),
});

// ---------------------------------------------------------------------------
// GET /businesses — real empty list until the ancillary-business table lands.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.get('/businesses', async (c: any) => {
  const parsed = ListBusinessesQuerySchema.safeParse({
    status: c.req.query('status'),
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
  return c.json({ success: true as const, data: [] as const }, 200);
});

export const miningAncillaryRouter = app;
export default app;
