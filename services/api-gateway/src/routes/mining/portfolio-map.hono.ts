// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/portfolio-map — GeoJSON FeatureCollection roll-up.
 *
 * Routes:
 *   GET  /     sites + licences + (settlement/protected stubs)
 *
 * Settlements + protected areas read from the geo schema once those
 * layers are populated. Until then they appear as empty feature
 * collections so the client can render the legend without crashing.
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { sites, licences } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { portfolioMapRoute } from './_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

function safeParseGeoJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

app.openapi(portfolioMapRoute, async (c) => {
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
    .filter((feature) => feature !== null);
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
    .filter((feature) => feature !== null);
  return c.json(
    {
      success: true as const,
      data: {
        type: 'FeatureCollection' as const,
        features: [...siteFeatures, ...licenceFeatures],
        layers: {
          sites: siteFeatures.length,
          licences: licenceFeatures.length,
          settlements: 0,
          protectedAreas: 0,
        },
      },
    },
    200,
  );
});

export const miningPortfolioMapRouter = app;
