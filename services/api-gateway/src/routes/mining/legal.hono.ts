/**
 * /api/v1/mining/legal — legal read surface (empty contract).
 *
 * Routes:
 *   GET   /contracts   list legal contracts for the tenant
 *
 * DOMAIN TABLE STILL NEEDED. Contract drafting runs through the
 * document-templates / document-composer packages, but there is no
 * first-class contracts-library table in `packages/database/src/schemas`
 * yet (the `contract_remediation` junior output is an AI-advice snapshot,
 * not a contracts ledger). Until the contracts-library table lands, this
 * route returns a real, non-fabricated empty list (200, []) so the panel
 * renders a proper "no records yet" state (NOT a dead CTA). Wire the real
 * query the day the contracts-library table ships.
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

const ListContractsQuerySchema = z.object({
  status: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100).optional(),
});

// ---------------------------------------------------------------------------
// GET /contracts — real empty list until the contracts-library table lands.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.get('/contracts', async (c: any) => {
  const parsed = ListContractsQuerySchema.safeParse({
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

export const miningLegalRouter = app;
export default app;
