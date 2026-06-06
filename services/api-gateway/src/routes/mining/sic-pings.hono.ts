/**
 * /api/v1/mining/sic-pings — worker SIC-ping reply (offline-flush alias, WF-6).
 *
 * The canonical SIC-ping reply endpoints live in `cockpit.hono.ts` under
 * `/api/v1/mining/cockpit/sic-pings`. BUT the workforce-mobile OFFLINE
 * QUEUE flushes `sic_ping` writes to `/api/v1/mining/sic-pings` —
 * `endpointFor('sic_ping')` resolves to `sic-pings` and the sync client
 * composes it under the bare mining prefix (NOT the cockpit prefix). See
 * apps/workforce-mobile/src/sync/{flush,endpoints}.ts +
 * apps/workforce-mobile/app/worker/W-M-05.tsx.
 *
 * This thin router catches that bare path and funnels into the SAME
 * `persistSicPingReply` helper, so there is exactly one write path + one
 * table-missing FLAG. Mount at `/sic-pings` under the mining router.
 *
 * Body (posted verbatim by the offline flush):
 *   { pingId: 'ping-<epoch>', loads, blockers, repliedAtISO }
 * `pingId` is a CLIENT ref, never a real ping id — stored as
 * `client_ping_ref` (no fabricated FK).
 *
 * RLS: databaseMiddleware binds app.current_tenant_id; the replies table
 * is FORCE-RLS.
 */

import { Hono } from 'hono';

import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import {
  persistSicPingReply,
  sicPingReplyBodySchema,
  type SicReplyWriter,
} from '../../services/sic-ping-reply';

export const miningSicPingsRouter = new Hono();
miningSicPingsRouter.use('*', authMiddleware);
miningSicPingsRouter.use('*', databaseMiddleware);

miningSicPingsRouter.post('/', async (c) => {
  const auth = c.get('auth') as { tenantId?: string; userId?: string };
  const db = c.get('db') as SicReplyWriter | null;
  if (!db || !auth?.tenantId || !auth?.userId) {
    return c.json(
      { success: false as const, error: { code: 'SIC_REPLY_DB_UNAVAILABLE' } },
      503,
    );
  }
  const raw = await c.req.json().catch(() => ({}));
  const parsed = sicPingReplyBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: { code: 'INVALID_BODY', issues: parsed.error.issues },
      },
      400,
    );
  }
  const result = await persistSicPingReply(
    db,
    { tenantId: auth.tenantId, userId: auth.userId },
    parsed.data,
    { realPingId: null },
  );
  if (result.ok) {
    return c.json({ success: true as const, data: { id: result.id } }, 201);
  }
  return c.json(
    {
      success: false as const,
      error: {
        code: result.code,
        ...(result.note ? { note: result.note } : {}),
      },
    },
    result.status,
  );
});

export default miningSicPingsRouter;
