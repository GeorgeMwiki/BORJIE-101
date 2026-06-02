/**
 * /api/v1/mining/accounting — accounting read surface.
 *
 * Routes:
 *   GET   /ledger   list accounting journal lines for the tenant (+ optional site)
 *
 * WS-4: this READS the REAL payments-ledger journals (`ledger_entries`) via the
 * `listLedgerLines` projection in @borjie/database. It is a READ-ONLY view over
 * the canonical double-entry ledger — it does NOT define a parallel ledger and
 * NEVER writes a ledger line (the money path stays on LedgerService.post(),
 * CLAUDE.md hard rule). The previous empty-list placeholder is gone.
 *
 * Tenant isolation is enforced by FORCE RLS on the pinned request connection
 * (`databaseMiddleware` binds `app.current_tenant_id`). Site scoping is
 * optional: when `siteId` is supplied we match `metadata->>'siteId'` (canonical
 * mining linkage) OR the legacy `property_id` column.
 *
 * Each line carries an ISO-4217 `currency` so the renderer threads it into
 * formatCurrency(amount, code) — money is NEVER hardcoded here.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { listLedgerLines } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

const ListLedgerQuerySchema = z.object({
  siteId: z.string().trim().min(1).max(80).optional(),
  range: z.enum(['30d', '90d', '12m']).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

/** Map a coarse range token to a `from` lower-bound (exclusive `to` = now). */
function rangeFrom(token: '30d' | '90d' | '12m' | undefined): Date | undefined {
  if (!token) return undefined;
  const from = new Date();
  switch (token) {
    case '30d':
      from.setUTCDate(from.getUTCDate() - 30);
      break;
    case '90d':
      from.setUTCDate(from.getUTCDate() - 90);
      break;
    case '12m':
      from.setUTCMonth(from.getUTCMonth() - 12);
      break;
  }
  return from;
}

// ---------------------------------------------------------------------------
// GET /ledger — real journal lines from the canonical ledger_entries.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.get('/ledger', async (c: any) => {
  const { tenantId } = c.get('auth');
  const parsed = ListLedgerQuerySchema.safeParse({
    siteId: c.req.query('siteId'),
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
  const lines = await listLedgerLines(db, tenantId, {
    siteId: parsed.data.siteId,
    from: rangeFrom(parsed.data.range),
    limit: parsed.data.limit,
  });

  return c.json(
    { success: true as const, data: lines, meta: { tenantId, count: lines.length } },
    200,
  );
});

export const miningAccountingRouter = app;
export default app;
