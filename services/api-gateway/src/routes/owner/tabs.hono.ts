/**
 * /api/v1/owner/tabs — owner-cockpit dynamic tab persistence.
 *
 * Wave OWNER-OS. The owner can spawn / pin / reorder / close tabs in
 * the cockpit home (Chat / Docs / Drafts / Reminders / Insights /
 * "Geita PML" / ...). The FE owns the schema of the `state` jsonb
 * document; this surface is a tiny per-user key-value store that
 * survives a sign-out + sign-in.
 *
 * Routes:
 *   GET /   — load the current user's tab state. Returns the default
 *             single-tab layout when the row does not exist yet.
 *
 *   PUT /   — replace the current user's tab state. Body is whatever
 *             jsonb shape the FE store wants; capped at 64 KB to keep
 *             accidental blobs out of the table.
 *
 * Auth: Supabase JWT via `authMiddleware`. Tenant scope bound by
 *       `databaseMiddleware`'s `app.tenant_id` GUC for RLS.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';

import { ownerTabs } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('owner-tabs');

const MAX_STATE_BYTES = 64 * 1024;

const DEFAULT_STATE: { tabs: ReadonlyArray<unknown>; activeTabId: string | null } = {
  tabs: [],
  activeTabId: null,
};

const putSchema = z.object({
  state: z
    .record(z.string(), z.unknown())
    .refine(
      (s) => JSON.stringify(s).length <= MAX_STATE_BYTES,
      `state must be <=${MAX_STATE_BYTES} bytes when JSON-stringified`,
    ),
});

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.get('/', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'OWNER_TABS_DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }

  const [row] = await db
    .select()
    .from(ownerTabs)
    .where(
      and(eq(ownerTabs.tenantId, auth.tenantId), eq(ownerTabs.userId, auth.userId)),
    )
    .limit(1);

  if (!row) {
    return c.json(
      {
        success: true,
        data: { state: DEFAULT_STATE, updatedAt: null, hydratedFromDefault: true },
      },
      200,
    );
  }
  return c.json({
    success: true,
    data: { state: row.state, updatedAt: row.updatedAt, hydratedFromDefault: false },
  });
});

app.put('/', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'OWNER_TABS_DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }

  const raw = await c.req.json().catch(() => null);
  const parsed = putSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid tabs payload', issues: parsed.error.issues } },
      400,
    );
  }

  const stateJson = parsed.data.state;
  const now = new Date();
  // Upsert by composite PK (tenant_id, user_id). The DEFAULT for `state`
  // is overridden by the supplied jsonb document; updatedAt is bumped on
  // every save so the FE can sort tab history conservatively.
  await db.execute(
    sql`
      INSERT INTO owner_tabs (tenant_id, user_id, state, updated_at)
      VALUES (${auth.tenantId}, ${auth.userId}, ${JSON.stringify(stateJson)}::jsonb, ${now})
      ON CONFLICT (tenant_id, user_id)
      DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at
    `,
  );

  moduleLogger.info('owner-tabs: state saved', {
    tenantId: auth.tenantId,
    userId: auth.userId,
    bytes: JSON.stringify(stateJson).length,
  });

  return c.json({ success: true, data: { state: stateJson, updatedAt: now } });
});

export const ownerTabsRouter = app;
export default ownerTabsRouter;
