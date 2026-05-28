/**
 * /api/v1/production/tonnage — supervisor tonnage capture (migration 0104).
 *
 * Captures ore + waste tonnage events from three sources:
 *   - field_app     (workforce-mobile supervisor screen)
 *   - plant_scale   (auto-ingest from plant SCADA)
 *   - manual_entry  (owner-web fallback)
 *
 * Routes (all tenant-scoped via JWT + RLS):
 *   POST   /tonnage              capture
 *   GET    /tonnage              list (siteId / from / to filters)
 *   POST   /tonnage/:id/qa-pass  supervisor sign-off
 *   GET    /tonnage/summary      daily aggregate (siteId / date)
 *
 * Backing table: `production_tonnage_events` (RLS FORCE-enabled).
 * The chat-as-OS brain reads / writes via the brain tools
 * `mining.production.log_tonnage`, `daily_summary`, `qa_backlog` —
 * both surfaces hit the identical backend.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { withSecurityEvents } from '@borjie/observability';

const TONNAGE_SOURCES = ['field_app', 'plant_scale', 'manual_entry'] as const;

const CaptureSchema = z.object({
  siteId: z.string().uuid(),
  shiftId: z.string().uuid().optional(),
  oreTonnes: z.number().nonnegative(),
  wasteTonnes: z.number().nonnegative().default(0),
  stripRatio: z.number().nonnegative().optional(),
  capturedAt: z.string().datetime().optional(),
  source: z.enum(TONNAGE_SOURCES),
  evidencePhotoIds: z.array(z.string().uuid()).max(20).default([]),
});

const ListQuerySchema = z.object({
  siteId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

const SummaryQuerySchema = z.object({
  siteId: z.string().uuid().optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional(),
});

const QaPassSchema = z.object({
  qaNote: z.string().max(2000).optional(),
});

function provenance(actorId: string, source: 'web' | 'mobile' | 'chat'): string {
  return JSON.stringify({
    capturedBy: actorId,
    capturedAt: new Date().toISOString(),
    source,
    via: source === 'chat' ? 'chat' : source === 'mobile' ? 'form' : 'api',
  });
}

function auditHash(input: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function unavailable(c: { json: (b: unknown, s: number) => Response }) {
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

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// ---------------------------------------------------------------------------
// POST /tonnage - capture
// ---------------------------------------------------------------------------

app.post(
  '/tonnage',
  zValidator('json', CaptureSchema),
  withSecurityEvents(
    {
      action: 'production.tonnage.capture',
      resource: 'production.tonnage_event',
      severity: 'info',
    },
    async (c) => {
      const auth = c.get('auth');
      const db = c.get('db');
      if (!db) return unavailable(c);
      const body = c.req.valid('json');
      const id = randomUUID();
      const capturedAt = body.capturedAt ?? new Date().toISOString();
      const prov = provenance(auth.userId, 'web');
      const hash = auditHash({
        id,
        tenantId: auth.tenantId,
        siteId: body.siteId,
        oreTonnes: body.oreTonnes,
        wasteTonnes: body.wasteTonnes,
        source: body.source,
      });

      await db.execute(sql`
        INSERT INTO production_tonnage_events (
          id, tenant_id, site_id, shift_id, recorded_by_id,
          ore_tonnes, waste_tonnes, strip_ratio, captured_at, source,
          evidence_photo_ids, qa_status, provenance, audit_hash_id
        ) VALUES (
          ${id}, ${auth.tenantId}::uuid, ${body.siteId}::uuid,
          ${body.shiftId ?? null}::uuid,
          ${auth.userId}::uuid,
          ${body.oreTonnes}, ${body.wasteTonnes},
          ${body.stripRatio ?? null},
          ${capturedAt}::timestamptz,
          ${body.source},
          ${body.evidencePhotoIds}::uuid[],
          'pending',
          ${prov}::jsonb, ${hash}
        )
      `);
      const fetched = await db.execute(sql`
        SELECT * FROM production_tonnage_events
         WHERE id = ${id}::uuid AND tenant_id = ${auth.tenantId}::uuid
         LIMIT 1
      `);
      const row = (fetched as unknown as Record<string, unknown>[])[0];
      return c.json({ success: true, data: row }, 201);
    },
  ),
);

// ---------------------------------------------------------------------------
// GET /tonnage - list with filters
// ---------------------------------------------------------------------------

app.get('/tonnage', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) return unavailable(c);
  const parsed = ListQuerySchema.safeParse({
    siteId: c.req.query('siteId'),
    from: c.req.query('from'),
    to: c.req.query('to'),
    limit: c.req.query('limit'),
  });
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      },
      400,
    );
  }
  const { siteId, from, to, limit } = parsed.data;
  const whereSite = siteId ? sql`AND site_id = ${siteId}::uuid` : sql``;
  const whereFrom = from ? sql`AND captured_at >= ${from}::timestamptz` : sql``;
  const whereTo = to ? sql`AND captured_at <= ${to}::timestamptz` : sql``;
  const rows = await db.execute(sql`
    SELECT * FROM production_tonnage_events
     WHERE tenant_id = ${auth.tenantId}::uuid
       ${whereSite}
       ${whereFrom}
       ${whereTo}
     ORDER BY captured_at DESC
     LIMIT ${limit}
  `);
  return c.json({
    success: true,
    data: (rows as unknown as Record<string, unknown>[]) ?? [],
  });
});

// ---------------------------------------------------------------------------
// POST /tonnage/:id/qa-pass - supervisor sign-off
// ---------------------------------------------------------------------------

app.post(
  '/tonnage/:id/qa-pass',
  zValidator('json', QaPassSchema),
  withSecurityEvents(
    {
      action: 'production.tonnage.qa_pass',
      resource: 'production.tonnage_event',
      severity: 'info',
    },
    async (c) => {
      const auth = c.get('auth');
      const db = c.get('db');
      if (!db) return unavailable(c);
      const id = c.req.param('id');

      const existing = await db.execute(sql`
        SELECT qa_status FROM production_tonnage_events
         WHERE id = ${id}::uuid AND tenant_id = ${auth.tenantId}::uuid
         LIMIT 1
      `);
      const existingRow = (
        existing as unknown as Record<string, unknown>[]
      )[0];
      if (!existingRow) {
        return c.json(
          {
            success: false,
            error: { code: 'NOT_FOUND', message: 'tonnage event not found' },
          },
          404,
        );
      }
      if (existingRow.qa_status === 'passed') {
        return c.json(
          {
            success: false,
            error: {
              code: 'ALREADY_PASSED',
              message: 'tonnage event already QA-passed',
            },
          },
          409,
        );
      }

      const passedAt = new Date().toISOString();
      await db.execute(sql`
        UPDATE production_tonnage_events
           SET qa_status     = 'passed',
               qa_passed_at  = ${passedAt}::timestamptz,
               qa_passed_by  = ${auth.userId}::uuid
         WHERE id = ${id}::uuid
           AND tenant_id = ${auth.tenantId}::uuid
      `);
      const fetched = await db.execute(sql`
        SELECT * FROM production_tonnage_events
         WHERE id = ${id}::uuid AND tenant_id = ${auth.tenantId}::uuid
         LIMIT 1
      `);
      const row = (fetched as unknown as Record<string, unknown>[])[0];
      return c.json({ success: true, data: row });
    },
  ),
);

// ---------------------------------------------------------------------------
// GET /tonnage/summary - daily aggregate
// ---------------------------------------------------------------------------

app.get('/tonnage/summary', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) return unavailable(c);
  const parsed = SummaryQuerySchema.safeParse({
    siteId: c.req.query('siteId'),
    date: c.req.query('date'),
  });
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      },
      400,
    );
  }
  const { siteId, date } = parsed.data;
  const targetDate = date ?? new Date().toISOString().slice(0, 10);
  const whereSite = siteId ? sql`AND site_id = ${siteId}::uuid` : sql``;
  const rows = await db.execute(sql`
    SELECT
      ${targetDate}::date                        AS for_date,
      COUNT(*)::int                              AS events,
      COALESCE(SUM(ore_tonnes), 0)::numeric      AS total_ore_tonnes,
      COALESCE(SUM(waste_tonnes), 0)::numeric    AS total_waste_tonnes,
      COUNT(*) FILTER (WHERE qa_status = 'pending')::int AS qa_pending,
      COUNT(*) FILTER (WHERE qa_status = 'passed')::int  AS qa_passed
    FROM production_tonnage_events
    WHERE tenant_id = ${auth.tenantId}::uuid
      AND captured_at::date = ${targetDate}::date
      ${whereSite}
  `);
  const row = (rows as unknown as Record<string, unknown>[])[0];
  return c.json({ success: true, data: row });
});

export const tonnageRouter = app;
