// @ts-nocheck — Hono v4 status-code union; read-only handlers use structural casts over services.db.
/**
 * Inspections router — Wave 18 real-data wiring.
 *
 * GET  /                — list inspections, tenant-scoped
 * GET  /:id             — single inspection
 * POST /                — 501 (schedule needs domain service; tracked)
 * PUT  /:id/start       — 501
 * POST /:id/items       — 501
 * PUT  /:id/complete    — REAL: validates body, updates row to 'completed'
 * POST /:id/sign        — 501
 *
 * Reads come from the `inspections` table via `services.db`. Write
 * endpoints return 501 NOT_IMPLEMENTED rather than 503 so clients can
 * distinguish "feature coming" from "service degraded".
 *
 * /:id/complete handler design:
 *   - Body validated by zod (areaResults, overallNotes?, photoCount?)
 *   - Loads the row first (tenant-scoped). 404 if missing.
 *   - 409 if status is already 'completed' (idempotency / double-tap guard)
 *   - Updates: status → 'completed', completedDate → NOW(),
 *              summary → overallNotes, notes → JSON({ areaResults, photoCount })
 *     The schema lacks a dedicated `areaResults` jsonb column today; we
 *     persist the structured payload through `notes` as a JSON blob so
 *     the inspector's findings aren't lost while a follow-up migration
 *     adds a first-class column.
 *   - Returns { id, status: 'completed', completedAt }
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { inspections } from '@borjie/database';
import { authMiddleware } from '../middleware/hono-auth';
import { routeCatch } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
const app = new Hono();
app.use('*', authMiddleware);

function dbUnavailable(c) {
  return c.json(
    {
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Inspections requires a live DATABASE_URL.',
      },
    },
    503,
  );
}

function notImplemented(c, verb) {
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: `${verb} inspections is not yet wired — read endpoints are live.`,
      },
    },
    501,
  );
}

app.get('/', async (c) => {
  const db = (c.get('services') ?? {}).db;
  if (!db) return dbUnavailable(c);
  const tenantId = c.get('tenantId');
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? '50') || 50));
  try {
    const rows = await db
      .select()
      .from(inspections)
      .where(eq(inspections.tenantId, tenantId))
      .orderBy(desc(inspections.createdAt))
      .limit(limit);
    return c.json({ success: true, data: rows });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'INSPECTIONS_QUERY_FAILED',
      status: 503,
      fallback: 'Query failed',
    });
  }
});

app.get('/:id', async (c) => {
  const db = (c.get('services') ?? {}).db;
  if (!db) return dbUnavailable(c);
  const tenantId = c.get('tenantId');
  const id = c.req.param('id');
  try {
    const [row] = await db
      .select()
      .from(inspections)
      .where(and(eq(inspections.tenantId, tenantId), eq(inspections.id, id)))
      .limit(1);
    if (!row) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Inspection not found' } },
        404,
      );
    }
    return c.json({ success: true, data: row });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'INSPECTIONS_QUERY_FAILED',
      status: 503,
      fallback: 'Query failed',
    });
  }
});

app.post('/', withSecurityEvents({ action: 'inspection.create', resource: 'inspection', severity: 'info' }, (c) => notImplemented(c, 'Scheduling')));
app.put('/:id/start', withSecurityEvents({ action: 'inspection.update', resource: 'inspection', severity: 'info' }, (c) => notImplemented(c, 'Starting')));
app.post('/:id/items', withSecurityEvents({ action: 'inspection.create', resource: 'inspection', severity: 'info' }, (c) => notImplemented(c, 'Adding items to')));
app.post('/:id/sign', withSecurityEvents({ action: 'inspection.create', resource: 'inspection', severity: 'info' }, (c) => notImplemented(c, 'Signing')));

// ============================================================================
// PUT /:id/complete — close an inspection with area-by-area results.
//
// Body shape (zod-validated):
//   {
//     areaResults: [{ area: string, rating: 'pass'|'fail'|'fix-needed', notes?: string, photoUrls?: string[] }],
//     overallNotes?: string,
//     photoCount?: number,
//   }
//
// Responses:
//   200 — { success: true, data: { id, status: 'completed', completedAt } }
//   400 — body validation failure (handled by zValidator)
//   404 — inspection not found in this tenant
//   409 — already completed (returns the existing record under data.existing)
// ============================================================================

const AreaResultSchema = z.object({
  area: z.string().min(1).max(200),
  rating: z.enum(['pass', 'fail', 'fix-needed']),
  notes: z.string().max(2000).optional(),
  photoUrls: z.array(z.string().url()).max(50).optional(),
});

const CompleteInspectionSchema = z.object({
  areaResults: z.array(AreaResultSchema).min(1).max(200),
  overallNotes: z.string().max(4000).optional(),
  photoCount: z.number().int().nonnegative().max(10_000).optional(),
});

app.put(
  '/:id/complete',
  zValidator('json', CompleteInspectionSchema),
  withSecurityEvents({ action: 'inspection.update', resource: 'inspection', severity: 'info' }, async (c) => {
    const db = (c.get('services') ?? {}).db;
    if (!db) return dbUnavailable(c);
    const tenantId = c.get('tenantId');
    const id = c.req.param('id');
    const body = c.req.valid('json');

    try {
      const [existing] = await db
        .select()
        .from(inspections)
        .where(and(eq(inspections.tenantId, tenantId), eq(inspections.id, id)))
        .limit(1);

      if (!existing) {
        return c.json(
          {
            success: false,
            error: { code: 'NOT_FOUND', message: 'Inspection not found' },
          },
          404,
        );
      }

      if (existing.status === 'completed') {
        return c.json(
          {
            success: false,
            error: {
              code: 'ALREADY_COMPLETED',
              message: 'Inspection has already been completed.',
            },
            data: { existing },
          },
          409,
        );
      }

      // Persist the structured area results through `notes` as JSON until
      // a dedicated `area_results` jsonb column lands. `summary` carries
      // the overall note. `completed_date` is set server-side via NOW()
      // so client clocks can't influence the audit trail.
      const notesPayload = JSON.stringify({
        areaResults: body.areaResults,
        photoCount: body.photoCount ?? null,
      });

      const [updated] = await db
        .update(inspections)
        .set({
          status: 'completed',
          completedDate: sql`NOW()`,
          summary: body.overallNotes ?? null,
          notes: notesPayload,
          updatedAt: sql`NOW()`,
          updatedBy: c.get('userId') ?? null,
        })
        .where(and(eq(inspections.tenantId, tenantId), eq(inspections.id, id)))
        .returning();

      const completedAt = updated?.completedDate
        ? new Date(updated.completedDate as unknown as string).toISOString()
        : new Date().toISOString();

      return c.json({
        success: true,
        data: {
          id,
          status: 'completed',
          completedAt,
        },
      });
    } catch (err) {
      return routeCatch(c, err, {
        code: 'INSPECTION_COMPLETE_FAILED',
        status: 503,
        fallback: 'Inspection complete failed',
      });
    }
  }),
);

export const inspectionsRouter = app;
