// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
// TODO(openapi-migration): convert this router from plain Hono to
// OpenAPIHono + createRoute (issue #60, follow-up to #19). Routes here
// are still picked up by the regex generator pass in
// scripts/generate-openapi-spec.mjs but lack typed response shapes.
/**
 * /api/v1/mining/portfolio-map — GeoJSON FeatureCollection roll-up.
 *
 * Routes:
 *   GET  /     sites + licences + (settlement/protected stubs)
 *
 * Settlements + protected areas read from the geo schema once those
 * layers are populated. Until then they appear as empty feature
 * collections so the client can render the legend without crashing.
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { sites, licences } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

function safeParseGeoJson(raw: string | null): unknown | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

app.get('/', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const [siteRows, licenceRows] = await Promise.all([
    db.select().from(sites).where(eq(sites.tenantId, tenantId)),
    db.select().from(licences).where(eq(licences.tenantId, tenantId)),
  ]);
  const siteFeatures = siteRows
    .map((row) => {
      const geometry = safeParseGeoJson(row.polygon ?? row.location ?? null);
      if (!geometry) return null;
      return {
        type: 'Feature' as const,
        geometry,
        properties: {
          layer: 'site',
          id: row.id,
          name: row.name,
          mineral: row.mineral,
          phase: row.phase,
          status: row.status,
          geologyConfidence: row.geologyConfidence,
        },
      };
    })
    .filter(Boolean);
  const licenceFeatures = licenceRows
    .map((row) => {
      const geometry = safeParseGeoJson(row.polygon ?? null);
      if (!geometry) return null;
      return {
        type: 'Feature' as const,
        geometry,
        properties: {
          layer: 'licence',
          id: row.id,
          kind: row.kind,
          number: row.number,
          mineral: row.mineral,
          status: row.status,
          expiryDate: row.expiryDate,
          dormancyScore: row.dormancyScore,
        },
      };
    })
    .filter(Boolean);
  return c.json({
    success: true,
    data: {
      type: 'FeatureCollection',
      features: [...siteFeatures, ...licenceFeatures],
      layers: {
        sites: siteFeatures.length,
        licences: licenceFeatures.length,
        settlements: 0,
        protectedAreas: 0,
      },
    },
  });
});

export const miningPortfolioMapRouter = app;
