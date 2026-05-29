/**
 * /api/v1/owner/saved-searches — Roadmap R2.
 *
 * Owner-defined saved searches with cadence-based alerts.
 *
 * Routes (all tenant-scoped via JWT + RLS):
 *   POST   /         create a saved search
 *   GET    /         list the caller's saved searches
 *   DELETE /:id      soft-delete (sets `disabled_at`)
 *
 * The chat-as-OS brain wires the parallel `owner.saved_search.create`
 * tool through `composition/brain-tools/owner-saved-search-tools.ts`
 * so both surfaces (explicit settings page + chat) hit the identical
 * backend.
 *
 * NOTE: ranking and execution of the saved search itself lives in
 * `workers/saved-search-worker.ts`. This file owns the CRUD shape only.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

export const SAVED_SEARCH_FREQUENCIES = [
  'hourly',
  'daily',
  'weekly',
] as const;
export const SAVED_SEARCH_SOURCES = [
  'marketplace',
  'opportunities',
  'regulatory',
] as const;

const CreateSavedSearchSchema = z.object({
  label: z.string().min(1).max(120),
  queryJson: z.record(z.unknown()).default({}),
  frequency: z.enum(SAVED_SEARCH_FREQUENCIES).default('daily'),
  source: z.enum(SAVED_SEARCH_SOURCES).default('marketplace'),
});

function rowToSavedSearch(row: Record<string, unknown> | null) {
  if (!row) return null;
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    userId: row.user_id as string,
    label: row.label as string,
    queryJson: (row.query_json ?? {}) as Record<string, unknown>,
    frequency: row.frequency as (typeof SAVED_SEARCH_FREQUENCIES)[number],
    source: row.source as (typeof SAVED_SEARCH_SOURCES)[number],
    lastRunAt: row.last_run_at as string | null,
    lastMatchCount: Number(row.last_match_count ?? 0),
    lastAlertAt: row.last_alert_at as string | null,
    disabledAt: row.disabled_at as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export const savedSearchesRouter = new Hono();
savedSearchesRouter.use('*', authMiddleware);
savedSearchesRouter.use('*', databaseMiddleware);

savedSearchesRouter.get('/', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) {
    return c.json(
      {
        success: false,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database client is not initialized',
        },
      },
      503,
    );
  }
  const result = await db.execute(sql`
    SELECT * FROM saved_searches
     WHERE tenant_id = ${auth.tenantId}
       AND user_id   = ${auth.userId}
       AND disabled_at IS NULL
     ORDER BY created_at DESC
     LIMIT 200
  `);
  const rows = (result as unknown as Record<string, unknown>[]) ?? [];
  return c.json({
    success: true,
    data: rows.map(rowToSavedSearch),
  });
});

savedSearchesRouter.post(
  '/',
  zValidator('json', CreateSavedSearchSchema),
  async (c) => {
    const auth = c.get('auth');
    const db = c.get('db');
    if (!db) {
      return c.json(
        {
          success: false,
          error: {
            code: 'DATABASE_UNAVAILABLE',
            message: 'Database client is not initialized',
          },
        },
        503,
      );
    }
    const body = c.req.valid('json');
    const id = randomUUID();
    await db.execute(sql`
      INSERT INTO saved_searches (
        id, tenant_id, user_id, label, query_json, frequency, source,
        last_match_count, created_at, updated_at
      ) VALUES (
        ${id}, ${auth.tenantId}, ${auth.userId}, ${body.label},
        ${JSON.stringify(body.queryJson)}::jsonb,
        ${body.frequency}, ${body.source},
        0, NOW(), NOW()
      )
    `);
    const fetched = await db.execute(sql`
      SELECT * FROM saved_searches
       WHERE id = ${id} AND tenant_id = ${auth.tenantId}
       LIMIT 1
    `);
    const row = (fetched as unknown as Record<string, unknown>[])[0];
    if (!row) {
      return c.json(
        {
          success: false,
          error: {
            code: 'SAVED_SEARCH_CREATE_FAILED',
            message: 'saved-search insert returned no row',
          },
        },
        500,
      );
    }
    return c.json({ success: true, data: rowToSavedSearch(row) }, 201);
  },
);

savedSearchesRouter.delete('/:id', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) {
    return c.json(
      {
        success: false,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database client is not initialized',
        },
      },
      503,
    );
  }
  const id = c.req.param('id');
  await db.execute(sql`
    UPDATE saved_searches
       SET disabled_at = NOW(), updated_at = NOW()
     WHERE id = ${id}
       AND tenant_id = ${auth.tenantId}
       AND user_id   = ${auth.userId}
  `);
  return c.json({ success: true, data: { id, disabled: true } });
});
