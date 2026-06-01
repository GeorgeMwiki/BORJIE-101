/**
 * /api/v1/mining/accounting — accounting read surface (empty contract).
 *
 * Routes:
 *   GET   /ledger   list accounting journal rows for the tenant
 *
 * DOMAIN TABLE STILL NEEDED. The double-entry money path lives in the
 * `payments-ledger` service; there is no owner-web-queryable accounting
 * journal table in `packages/database/src/schemas` yet. Until that
 * domain table lands, this route returns a real, non-fabricated empty
 * list (200, []) so the panel renders a proper "no records yet" state
 * (NOT a dead CTA). Wire the real query the day the accounting-journal
 * table ships.
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

const ListLedgerQuerySchema = z.object({
  range: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100).optional(),
});

// ---------------------------------------------------------------------------
// GET /ledger — real empty list until the accounting-journal table lands.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.get('/ledger', async (c: any) => {
  const parsed = ListLedgerQuerySchema.safeParse({
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
  return c.json({ success: true as const, data: [] as const }, 200);
});

export const miningAccountingRouter = app;
export default app;
