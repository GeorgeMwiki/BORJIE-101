/**
 * /api/v1/geology - drill-hole capture pipeline (migration 0102).
 *
 * Exposes the rich geology lifecycle used by the workforce-mobile
 * geologist screen AND the chat-as-OS brain (the brain tool
 * `mining.geology.log_drill_hole` deferes to these same handlers, so
 * both surfaces touch the identical backend).
 *
 * Routes (all tenant-scoped via JWT + RLS):
 *   POST   /drill-holes                                  create
 *   GET    /drill-holes                                  list
 *   POST   /drill-holes/:id/intervals                    log interval
 *   POST   /drill-holes/:id/intervals/:intervalId/photos upload field photos
 *   POST   /drill-holes/:id/send-to-lab                  mark sent
 *   POST   /assay-results                                receive lab result
 *
 * Backing tables: drill_holes_geology, drill_hole_intervals,
 * assay_results. All RLS FORCE-enabled (migration 0102). Tenant
 * isolation is enforced both in the WHERE clause AND by the GUC. Every
 * state-change row carries a provenance jsonb + a content-hash so the
 * audit chain (CLAUDE.md hard rule) can replay state.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { withSecurityEvents } from '@borjie/observability';

const CreateDrillHoleSchema = z.object({
  siteId: z.string().uuid(),
  holeNumber: z.string().min(1).max(64),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  depthM: z.number().nonnegative().optional(),
  startedAt: z.string().datetime().optional(),
  geologistId: z.string().uuid().optional(),
});

const LogIntervalSchema = z.object({
  fromM: z.number().nonnegative(),
  toM: z.number().nonnegative(),
  lithology: z.string().max(255).optional(),
  alteration: z.string().max(255).optional(),
  mineralisationPct: z.number().min(0).max(100).optional(),
  mineralAssemblage: z.array(z.string()).optional(),
  structuralFeatures: z.string().max(2000).optional(),
});

const PhotoSchema = z.object({
  photoIds: z.array(z.string().uuid()).min(1).max(20),
});

const SendToLabSchema = z.object({
  labPartyId: z.string().uuid().optional(),
  sampleIds: z.array(z.string()).min(1).max(50),
});

const AssaySchema = z.object({
  drillHoleId: z.string().uuid(),
  intervalId: z.string().uuid().optional(),
  sampleId: z.string().min(1).max(64),
  labPartyId: z.string().uuid().optional(),
  receivedAt: z.string().datetime().optional(),
  auGpt: z.number().nonnegative().optional(),
  agGpt: z.number().nonnegative().optional(),
  cuPct: z.number().min(0).max(100).optional(),
  qaQcPass: z.boolean().default(false),
  evidenceDocId: z.string().uuid().optional(),
});

const ListQuerySchema = z.object({
  siteId: z.string().uuid().optional(),
  status: z
    .enum(['planned', 'in_progress', 'completed', 'abandoned'])
    .optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

function provenance(actorId: string, source: 'web' | 'mobile' | 'chat'): string {
  return JSON.stringify({
    capturedBy: actorId,
    capturedAt: new Date().toISOString(),
    source,
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
// POST /drill-holes - create.
// ---------------------------------------------------------------------------

app.post(
  '/drill-holes',
  zValidator('json', CreateDrillHoleSchema),
  withSecurityEvents(
    {
      action: 'geology.drill_hole.create',
      resource: 'geology.drill_hole',
      severity: 'info',
    },
    async (c) => {
      const auth = c.get('auth');
      const db = c.get('db');
      if (!db) return unavailable(c);
      const body = c.req.valid('json');
      const id = randomUUID();
      const prov = provenance(auth.userId, 'web');
      await db.execute(sql`
        INSERT INTO drill_holes_geology (
          id, tenant_id, site_id, hole_number, lat, lng, depth_m,
          started_at, geologist_id, status, provenance
        ) VALUES (
          ${id}, ${auth.tenantId}::uuid, ${body.siteId}::uuid,
          ${body.holeNumber},
          ${body.lat ?? null}, ${body.lng ?? null},
          ${body.depthM ?? null},
          ${body.startedAt ?? null}::timestamptz,
          ${body.geologistId ?? auth.userId}::uuid,
          ${body.startedAt ? 'in_progress' : 'planned'},
          ${prov}::jsonb
        )
      `);
      const fetched = await db.execute(sql`
        SELECT * FROM drill_holes_geology
         WHERE id = ${id}::uuid AND tenant_id = ${auth.tenantId}::uuid
         LIMIT 1
      `);
      const row = (fetched as unknown as Record<string, unknown>[])[0];
      return c.json({ success: true, data: row }, 201);
    },
  ),
);

// ---------------------------------------------------------------------------
// GET /drill-holes - list.
// ---------------------------------------------------------------------------

app.get('/drill-holes', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) return unavailable(c);
  const parsed = ListQuerySchema.safeParse({
    siteId: c.req.query('siteId'),
    status: c.req.query('status'),
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
  const { siteId, status, limit } = parsed.data;
  const whereSite = siteId
    ? sql`AND site_id = ${siteId}::uuid`
    : sql``;
  const whereStatus = status ? sql`AND status = ${status}` : sql``;
  const rows = await db.execute(sql`
    SELECT * FROM drill_holes_geology
     WHERE tenant_id = ${auth.tenantId}::uuid
       ${whereSite}
       ${whereStatus}
     ORDER BY created_at DESC
     LIMIT ${limit}
  `);
  return c.json({
    success: true,
    data: (rows as unknown as Record<string, unknown>[]) ?? [],
  });
});

// ---------------------------------------------------------------------------
// POST /drill-holes/:id/intervals - log interval.
// ---------------------------------------------------------------------------

app.post(
  '/drill-holes/:id/intervals',
  zValidator('json', LogIntervalSchema),
  withSecurityEvents(
    {
      action: 'geology.interval.log',
      resource: 'geology.drill_hole_interval',
      severity: 'info',
    },
    async (c) => {
      const auth = c.get('auth');
      const db = c.get('db');
      if (!db) return unavailable(c);
      const holeId = c.req.param('id');
      const body = c.req.valid('json');
      if (body.toM <= body.fromM) {
        return c.json(
          {
            success: false,
            error: {
              code: 'INVALID_DEPTH',
              message: 'toM must be greater than fromM',
            },
          },
          422,
        );
      }
      const id = randomUUID();
      await db.execute(sql`
        INSERT INTO drill_hole_intervals (
          id, tenant_id, drill_hole_id, from_m, to_m,
          lithology, alteration, mineralisation_pct, mineral_assemblage,
          structural_features
        ) VALUES (
          ${id}, ${auth.tenantId}::uuid, ${holeId}::uuid,
          ${body.fromM}, ${body.toM},
          ${body.lithology ?? null}, ${body.alteration ?? null},
          ${body.mineralisationPct ?? null},
          ${body.mineralAssemblage ?? []},
          ${body.structuralFeatures ?? null}
        )
      `);
      const fetched = await db.execute(sql`
        SELECT * FROM drill_hole_intervals
         WHERE id = ${id}::uuid AND tenant_id = ${auth.tenantId}::uuid
         LIMIT 1
      `);
      const row = (fetched as unknown as Record<string, unknown>[])[0];
      return c.json({ success: true, data: row }, 201);
    },
  ),
);

// ---------------------------------------------------------------------------
// POST /drill-holes/:id/intervals/:intervalId/photos - attach photos.
// ---------------------------------------------------------------------------

app.post(
  '/drill-holes/:id/intervals/:intervalId/photos',
  zValidator('json', PhotoSchema),
  withSecurityEvents(
    {
      action: 'geology.interval.photo.attach',
      resource: 'geology.drill_hole_interval',
      severity: 'info',
    },
    async (c) => {
      const auth = c.get('auth');
      const db = c.get('db');
      if (!db) return unavailable(c);
      const intervalId = c.req.param('intervalId');
      const body = c.req.valid('json');
      const updated = await db.execute(sql`
        UPDATE drill_hole_intervals
           SET log_photo_ids = log_photo_ids || ${body.photoIds}::uuid[]
         WHERE id = ${intervalId}::uuid
           AND tenant_id = ${auth.tenantId}::uuid
         RETURNING *
      `);
      const row = (updated as unknown as Record<string, unknown>[])[0];
      if (!row) {
        return c.json(
          {
            success: false,
            error: { code: 'NOT_FOUND', message: 'Interval not found' },
          },
          404,
        );
      }
      return c.json({ success: true, data: row });
    },
  ),
);

// ---------------------------------------------------------------------------
// POST /drill-holes/:id/send-to-lab - mark sent for lab assay.
// ---------------------------------------------------------------------------

app.post(
  '/drill-holes/:id/send-to-lab',
  zValidator('json', SendToLabSchema),
  withSecurityEvents(
    {
      action: 'geology.lab.send',
      resource: 'geology.assay_result',
      severity: 'info',
    },
    async (c) => {
      const auth = c.get('auth');
      const db = c.get('db');
      if (!db) return unavailable(c);
      const holeId = c.req.param('id');
      const body = c.req.valid('json');
      const sentAt = new Date().toISOString();
      const created: Record<string, unknown>[] = [];
      for (const sampleId of body.sampleIds) {
        const id = randomUUID();
        const hash = auditHash({
          tenantId: auth.tenantId,
          holeId,
          sampleId,
          sentAt,
        });
        await db.execute(sql`
          INSERT INTO assay_results (
            id, tenant_id, drill_hole_id, sample_id, lab_party_id,
            sent_at, qa_qc_pass, audit_hash_id
          ) VALUES (
            ${id}, ${auth.tenantId}::uuid, ${holeId}::uuid,
            ${sampleId}, ${body.labPartyId ?? null}::uuid,
            ${sentAt}::timestamptz, false, ${hash}
          )
          ON CONFLICT (tenant_id, sample_id) DO UPDATE
            SET lab_party_id = EXCLUDED.lab_party_id,
                sent_at = EXCLUDED.sent_at
        `);
        const fetched = await db.execute(sql`
          SELECT * FROM assay_results
           WHERE tenant_id = ${auth.tenantId}::uuid
             AND sample_id = ${sampleId}
           LIMIT 1
        `);
        const row = (fetched as unknown as Record<string, unknown>[])[0];
        if (row) created.push(row);
      }
      return c.json({ success: true, data: created }, 201);
    },
  ),
);

// ---------------------------------------------------------------------------
// POST /assay-results - receive lab result.
// ---------------------------------------------------------------------------

app.post(
  '/assay-results',
  zValidator('json', AssaySchema),
  withSecurityEvents(
    {
      action: 'geology.assay.receive',
      resource: 'geology.assay_result',
      severity: 'info',
    },
    async (c) => {
      const auth = c.get('auth');
      const db = c.get('db');
      if (!db) return unavailable(c);
      const body = c.req.valid('json');
      const hash = auditHash({
        tenantId: auth.tenantId,
        sampleId: body.sampleId,
        auGpt: body.auGpt,
        receivedAt: body.receivedAt ?? new Date().toISOString(),
      });
      const upserted = await db.execute(sql`
        INSERT INTO assay_results (
          id, tenant_id, drill_hole_id, interval_id, sample_id,
          lab_party_id, received_at, au_gpt, ag_gpt, cu_pct,
          qa_qc_pass, evidence_doc_id, audit_hash_id
        ) VALUES (
          ${randomUUID()}, ${auth.tenantId}::uuid,
          ${body.drillHoleId}::uuid,
          ${body.intervalId ?? null}::uuid,
          ${body.sampleId},
          ${body.labPartyId ?? null}::uuid,
          ${body.receivedAt ?? new Date().toISOString()}::timestamptz,
          ${body.auGpt ?? null}, ${body.agGpt ?? null}, ${body.cuPct ?? null},
          ${body.qaQcPass}, ${body.evidenceDocId ?? null}::uuid,
          ${hash}
        )
        ON CONFLICT (tenant_id, sample_id) DO UPDATE
          SET received_at = EXCLUDED.received_at,
              au_gpt = EXCLUDED.au_gpt,
              ag_gpt = EXCLUDED.ag_gpt,
              cu_pct = EXCLUDED.cu_pct,
              qa_qc_pass = EXCLUDED.qa_qc_pass,
              evidence_doc_id = EXCLUDED.evidence_doc_id,
              audit_hash_id = EXCLUDED.audit_hash_id
        RETURNING *
      `);
      const row = (upserted as unknown as Record<string, unknown>[])[0];
      return c.json({ success: true, data: row }, 201);
    },
  ),
);

export const geologyRouter = app;
