/**
 * /api/v1/regulatory/zones — Tanzania regulatory geo lookup.
 *
 * Companion to:
 *   - packages/database/src/migrations/0130_postgis.sql
 *   - services/api-gateway/src/services/geofencing/
 *   - Docs/RESEARCH/GEO_SOTA_2026-05-29.md §5
 *
 * Endpoints:
 *   GET  /by-point?lat=&lon=&authority=  → PCCB / NEMC / EITI zones
 *                                          containing the point.
 *
 * Tenant-agnostic — regulatory boundaries are public records. Auth
 * is still required so we know who is asking (rate limits + audit).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { createGeofencingService } from '../../services/geofencing/index.js';
import { authMiddleware } from '../../middleware/hono-auth.js';
import { databaseMiddleware } from '../../middleware/database.js';
import { createLogger } from '../../utils/logger.js';

const moduleLogger = createLogger('regulatory-zones');

const byPointQuerySchema = z.object({
  lat: z.coerce.number().gte(-90).lte(90),
  lon: z.coerce.number().gte(-180).lte(180),
  authority: z.enum(['pccb', 'nemc', 'eiti']).optional(),
});

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.get('/by-point', async (c) => {
  const parsed = byPointQuerySchema.safeParse({
    lat: c.req.query('lat'),
    lon: c.req.query('lon'),
    authority: c.req.query('authority'),
  });
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'INVALID_PARAMS',
          message: parsed.error.message,
        },
      },
      400,
    );
  }
  const db = c.get('db');
  if (!db) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'DEGRADED',
          message: 'regulatory zone lookup unavailable in degraded mode',
        },
      },
      503,
    );
  }
  try {
    const geofencing = createGeofencingService({
      db: db as unknown as { execute(q: unknown): Promise<unknown> },
    });
    const authorities = parsed.data.authority
      ? [parsed.data.authority]
      : (['pccb', 'nemc', 'eiti'] as const);
    const zones = await geofencing.pointInComplianceZone(
      { lat: parsed.data.lat, lon: parsed.data.lon },
      authorities,
    );
    return c.json(
      {
        success: true as const,
        data: {
          point: { lat: parsed.data.lat, lon: parsed.data.lon },
          zones,
          count: zones.length,
        },
      },
      200,
    );
  } catch (err) {
    moduleLogger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'regulatory zones by-point failed',
    );
    return c.json(
      {
        success: false as const,
        error: {
          code: 'LOOKUP_FAILED',
          message: 'regulatory zone lookup failed',
        },
      },
      500,
    );
  }
});

export const regulatoryZonesRouter = app;
