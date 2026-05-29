/**
 * /api/v1/workforce — biometric clock-in / clock-out (migration 0103).
 *
 * Exposes the clock-in lifecycle used by the workforce-mobile
 * (`expo-local-authentication`) screen and the owner-web WebAuthn
 * kiosk. The chat-as-OS brain reads via the brain tools
 * `workforce.clock_in_query` / `workforce.attendance_status` — both
 * surfaces hit the identical backend (Chat-as-OS bidirectional parity).
 *
 * Routes (all tenant-scoped via JWT + RLS):
 *   POST   /clock-in                  - record event
 *   POST   /clock-out/:eventId        - close event
 *   GET    /clock-in/today?siteId=    - list today's open / closed
 *
 * Backing table: `clock_in_events` (RLS FORCE-enabled, migration 0103).
 * Provenance jsonb stamped on every row; the brain attaches
 * `via=chat` + `sessionId/turnId` so the row's pill deep-links back to
 * the originating chat turn.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { publishCockpitEvent } from '../../services/cockpit-events';
import { withSecurityEvents } from '@borjie/observability';

const PRODUCTION_BIOMETRIC_PROVIDERS = [
  'expo_local_auth',
  'webauthn_platform',
  'webauthn_cross_platform',
  'fingerprint_device',
  'face_id',
  'touch_id',
  'pin_fallback',
  'manual_supervisor',
] as const;

const ClockInSchema = z.object({
  employeeId: z.string().uuid(),
  siteId: z.string().uuid(),
  biometricProvider: z.enum(PRODUCTION_BIOMETRIC_PROVIDERS),
  biometricPassed: z.boolean(),
  deviceId: z.string().max(255).optional(),
  geoLat: z.number().min(-90).max(90).optional(),
  geoLng: z.number().min(-180).max(180).optional(),
});

const ClockOutSchema = z.object({
  closedBy: z.string().uuid().optional(),
});

const TodayQuerySchema = z.object({
  siteId: z.string().uuid().optional(),
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
// POST /clock-in - record event
// ---------------------------------------------------------------------------

app.post(
  '/clock-in',
  zValidator('json', ClockInSchema),
  withSecurityEvents(
    {
      action: 'workforce.clock_in.record',
      resource: 'workforce.clock_in_event',
      severity: 'info',
    },
    async (c) => {
      const auth = c.get('auth');
      const db = c.get('db');
      if (!db) return unavailable(c);
      const body = c.req.valid('json');

      // Production tenants MUST pass biometric. Audit-only tenants
      // (audit / dev) can override via biometricProvider='manual_supervisor'.
      if (
        !body.biometricPassed &&
        body.biometricProvider !== 'manual_supervisor'
      ) {
        return c.json(
          {
            success: false,
            error: {
              code: 'BIOMETRIC_REQUIRED',
              message:
                'biometricPassed must be true for non-manual_supervisor providers',
            },
          },
          422,
        );
      }

      const id = randomUUID();
      const prov = provenance(auth.userId, 'web');
      const hash = auditHash({
        id,
        tenantId: auth.tenantId,
        employeeId: body.employeeId,
        siteId: body.siteId,
        provider: body.biometricProvider,
      });

      await db.execute(sql`
        INSERT INTO clock_in_events (
          id, tenant_id, employee_id, site_id,
          biometric_provider, biometric_passed,
          device_id, geo_lat, geo_lng, provenance, audit_hash_id
        ) VALUES (
          ${id}, ${auth.tenantId}::uuid, ${body.employeeId}::uuid,
          ${body.siteId}::uuid,
          ${body.biometricProvider}, ${body.biometricPassed},
          ${body.deviceId ?? null},
          ${body.geoLat ?? null}, ${body.geoLng ?? null},
          ${prov}::jsonb, ${hash}
        )
      `);

      const fetched = await db.execute(sql`
        SELECT * FROM clock_in_events
         WHERE id = ${id}::uuid AND tenant_id = ${auth.tenantId}::uuid
         LIMIT 1
      `);
      const row = (fetched as unknown as Record<string, unknown>[])[0];

      // R6 — cockpit SSE notify. Shift_start emitted right after
      // the row landed so the cockpit dot ticks within the same RT
      // window as the kiosk audit-log.
      publishCockpitEvent({
        kind: 'workforce.shift_event',
        tenantId: auth.tenantId,
        emittedAt: new Date().toISOString(),
        workerId: body.employeeId,
        transition: 'shift_start',
      });

      return c.json({ success: true, data: row }, 201);
    },
  ),
);

// ---------------------------------------------------------------------------
// POST /clock-out/:eventId - close event
// ---------------------------------------------------------------------------

app.post(
  '/clock-out/:eventId',
  zValidator('json', ClockOutSchema),
  withSecurityEvents(
    {
      action: 'workforce.clock_in.close',
      resource: 'workforce.clock_in_event',
      severity: 'info',
    },
    async (c) => {
      const auth = c.get('auth');
      const db = c.get('db');
      if (!db) return unavailable(c);
      const eventId = c.req.param('eventId');
      const closedAt = new Date().toISOString();

      const existing = await db.execute(sql`
        SELECT clocked_out_at, employee_id FROM clock_in_events
         WHERE id = ${eventId}::uuid AND tenant_id = ${auth.tenantId}::uuid
         LIMIT 1
      `);
      const existingRow = (
        existing as unknown as Record<string, unknown>[]
      )[0];
      if (!existingRow) {
        return c.json(
          {
            success: false,
            error: { code: 'NOT_FOUND', message: 'clock-in event not found' },
          },
          404,
        );
      }
      if (existingRow.clocked_out_at) {
        return c.json(
          {
            success: false,
            error: {
              code: 'ALREADY_CLOSED',
              message: 'clock-in event already closed',
            },
          },
          409,
        );
      }

      await db.execute(sql`
        UPDATE clock_in_events
           SET clocked_out_at = ${closedAt}::timestamptz
         WHERE id = ${eventId}::uuid
           AND tenant_id = ${auth.tenantId}::uuid
      `);
      const fetched = await db.execute(sql`
        SELECT * FROM clock_in_events
         WHERE id = ${eventId}::uuid AND tenant_id = ${auth.tenantId}::uuid
         LIMIT 1
      `);
      const row = (fetched as unknown as Record<string, unknown>[])[0];

      // R6 — cockpit SSE notify. employee_id from the existingRow
      // read above is the canonical worker for this shift.
      const workerId = (existingRow as { employee_id?: string }).employee_id
        ?? (row as { employee_id?: string } | undefined)?.employee_id
        ?? null;
      if (workerId) {
        publishCockpitEvent({
          kind: 'workforce.shift_event',
          tenantId: auth.tenantId,
          emittedAt: closedAt,
          workerId,
          transition: 'shift_end',
        });
      }

      return c.json({ success: true, data: row });
    },
  ),
);

// ---------------------------------------------------------------------------
// GET /clock-in/today - list today's events
// ---------------------------------------------------------------------------

app.get('/clock-in/today', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) return unavailable(c);
  const parsed = TodayQuerySchema.safeParse({ siteId: c.req.query('siteId') });
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      },
      400,
    );
  }
  const { siteId } = parsed.data;
  const whereSite = siteId ? sql`AND site_id = ${siteId}::uuid` : sql``;
  const rows = await db.execute(sql`
    SELECT * FROM clock_in_events
     WHERE tenant_id = ${auth.tenantId}::uuid
       AND clocked_in_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Dar_es_Salaam')
       ${whereSite}
     ORDER BY clocked_in_at DESC
     LIMIT 500
  `);
  return c.json({
    success: true,
    data: (rows as unknown as Record<string, unknown>[]) ?? [],
  });
});

export const workforceClockInRouter = app;
