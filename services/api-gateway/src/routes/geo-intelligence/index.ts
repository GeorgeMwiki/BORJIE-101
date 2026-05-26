/**
 * Geo-intelligence routes.
 *
 *   GET  /v1/geo/parcels/:id              full parcel + layers + assoc graph hop-1
 *   GET  /v1/geo/parcels/:id/history      event-sourced timeline
 *   GET  /v1/geo/parcels/:id/explore      rich exploration payload
 *   GET  /v1/geo/areas/:id/segments       segmentation overlay
 *   POST /v1/geo/parcels/:id/subdivide    legal subdivision
 *   POST /v1/geo/parcels/merge            merge multiple parcels
 *   GET  /v1/geo/spatial/within           viewport query
 *   GET  /v1/geo/spatial/nearest          k-nearest
 *
 * Wraps every mutating route in `withSecurityEvents`. Backed by the
 * in-memory `geoIntelligence` orchestrator from `@borjie/geo-intelligence`;
 * production swaps the in-memory stores for PostGIS-backed adapters.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import {
  createGeoIntelligence,
  type GeoIntelligence,
} from '@borjie/geo-intelligence';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth.js';
import { safeInternalError } from '../../utils/safe-error.js';

// Shared singleton — production wires per-request DB-backed stores via
// a composition root and passes it in.
let _gi: GeoIntelligence | null = null;

export function getGeoIntelligence(): GeoIntelligence {
  if (!_gi) _gi = createGeoIntelligence();
  return _gi;
}

export function resetGeoIntelligenceForTests(): void {
  _gi = null;
}

const router = new Hono();
router.use('*', authMiddleware);

// ---------------------------------------------------------------------------
// GET /v1/geo/parcels/:id
// ---------------------------------------------------------------------------
router.get('/parcels/:id', async (c) => {
  const parcelId = c.req.param('id');
  if (!parcelId) {
    return c.json({ success: false, error: { code: 'BAD_REQUEST', message: 'parcelId required' } }, 400);
  }
  const gi = getGeoIntelligence();
  try {
    const layers = gi.layerStore.mergeLayers(parcelId);
    const associations = gi.graph.getAssociations(parcelId);
    return c.json({
      success: true,
      data: { parcelId, layers, associations },
    });
  } catch (e) {
    return safeInternalError(c, e, { code: 'GEO_FETCH_FAILED', fallback: 'geo fetch failed' });
  }
});

// ---------------------------------------------------------------------------
// GET /v1/geo/parcels/:id/history
// ---------------------------------------------------------------------------
const HistoryQuerySchema = z.object({
  kinds: z.string().optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
});

router.get('/parcels/:id/history', async (c) => {
  const parcelId = c.req.param('id');
  if (!parcelId) {
    return c.json({ success: false, error: { code: 'BAD_REQUEST', message: 'parcelId required' } }, 400);
  }
  const parsed = HistoryQuerySchema.safeParse({
    kinds: c.req.query('kinds'),
    since: c.req.query('since'),
    until: c.req.query('until'),
  });
  if (!parsed.success) {
    return c.json({ success: false, error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
  }
  const gi = getGeoIntelligence();
  const filter: { kinds?: string[]; since?: string; until?: string } = {};
  if (parsed.data.kinds) filter.kinds = parsed.data.kinds.split(',');
  if (parsed.data.since) filter.since = parsed.data.since;
  if (parsed.data.until) filter.until = parsed.data.until;
  const history = gi.eventStore.getHistory(parcelId, filter as never);
  return c.json({ success: true, data: { parcelId, history } });
});

// ---------------------------------------------------------------------------
// GET /v1/geo/parcels/:id/explore
// ---------------------------------------------------------------------------
router.get('/parcels/:id/explore', async (c) => {
  const parcelId = c.req.param('id');
  if (!parcelId) {
    return c.json({ success: false, error: { code: 'BAD_REQUEST', message: 'parcelId required' } }, 400);
  }
  const gi = getGeoIntelligence();
  try {
    const explore = await gi.explore(parcelId);
    return c.json({ success: true, data: explore });
  } catch (e) {
    return safeInternalError(c, e, { code: 'GEO_EXPLORE_FAILED', fallback: 'explore failed' });
  }
});

// ---------------------------------------------------------------------------
// GET /v1/geo/areas/:id/segments
// ---------------------------------------------------------------------------
router.get('/areas/:id/segments', async (c) => {
  const areaId = c.req.param('id');
  if (!areaId) {
    return c.json({ success: false, error: { code: 'BAD_REQUEST', message: 'areaId required' } }, 400);
  }
  // Stub: in production this queries segments by area; in-memory orchestrator
  // currently doesn't model "areas" so we just return the parcel itself if it
  // exists.
  const gi = getGeoIntelligence();
  const parcel = gi.spatialIndex.all().find((p) => p.parcelId === areaId);
  return c.json({
    success: true,
    data: {
      areaId,
      segments: parcel ? [parcel.parcelId] : [],
    },
  });
});

// ---------------------------------------------------------------------------
// POST /v1/geo/parcels/:id/subdivide
// ---------------------------------------------------------------------------
const SubdivideBodySchema = z.object({
  cutLine: z.array(z.tuple([z.number(), z.number()])).length(2),
  tenantId: z.string().min(1),
});

router.post('/parcels/:id/subdivide', withSecurityEvents(
  { action: 'geo.parcel.subdivide', resource: 'parcel', severity: 'notice' },
  async (c) => {
    const parcelId = c.req.param('id');
    if (!parcelId) {
      return c.json({ success: false, error: { code: 'BAD_REQUEST', message: 'parcelId required' } }, 400);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: { code: 'INVALID_JSON', message: 'invalid JSON body' } }, 400);
    }
    const parsed = SubdivideBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    }
    const gi = getGeoIntelligence();
    gi.eventStore.recordEvent({
      parcelId,
      tenantId: parsed.data.tenantId,
      kind: 'subdivided',
      payload: { cutLine: parsed.data.cutLine },
    });
    return c.json({
      success: true,
      data: { parcelId, status: 'subdivided', cutLine: parsed.data.cutLine },
    }, 201);
  },
));

// ---------------------------------------------------------------------------
// POST /v1/geo/parcels/merge
// ---------------------------------------------------------------------------
const MergeBodySchema = z.object({
  parcelIds: z.array(z.string().min(1)).min(2),
  tenantId: z.string().min(1),
  mergedName: z.string().optional(),
});

router.post('/parcels/merge', withSecurityEvents(
  { action: 'geo.parcel.merge', resource: 'parcel', severity: 'notice' },
  async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: { code: 'INVALID_JSON', message: 'invalid JSON body' } }, 400);
    }
    const parsed = MergeBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: { code: 'BAD_REQUEST', message: parsed.error.message } }, 400);
    }
    const gi = getGeoIntelligence();
    for (const pid of parsed.data.parcelIds) {
      gi.eventStore.recordEvent({
        parcelId: pid,
        tenantId: parsed.data.tenantId,
        kind: 'merged',
        payload: { mergedWith: parsed.data.parcelIds, mergedName: parsed.data.mergedName },
      });
    }
    return c.json({
      success: true,
      data: { parcelIds: parsed.data.parcelIds, status: 'merged' },
    }, 201);
  },
));

// ---------------------------------------------------------------------------
// GET /v1/geo/spatial/within
// ---------------------------------------------------------------------------
router.get('/spatial/within', async (c) => {
  const bbox = c.req.query('bbox');
  if (!bbox) {
    return c.json({ success: false, error: { code: 'BAD_REQUEST', message: 'bbox query (minLon,minLat,maxLon,maxLat) required' } }, 400);
  }
  const parts = bbox.split(',').map((p) => Number.parseFloat(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return c.json({ success: false, error: { code: 'BAD_REQUEST', message: 'bbox must be 4 numbers' } }, 400);
  }
  const [minLon, minLat, maxLon, maxLat] = parts as [number, number, number, number];
  const gi = getGeoIntelligence();
  const hits = gi.spatialIndex.parcelsWithin({ minLon, minLat, maxLon, maxLat });
  return c.json({ success: true, data: { count: hits.length, parcels: hits } });
});

// ---------------------------------------------------------------------------
// GET /v1/geo/spatial/nearest
// ---------------------------------------------------------------------------
router.get('/spatial/nearest', async (c) => {
  const lat = Number.parseFloat(c.req.query('lat') ?? '');
  const lng = Number.parseFloat(c.req.query('lng') ?? '');
  const k = Number.parseInt(c.req.query('k') ?? '10', 10);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(k)) {
    return c.json({ success: false, error: { code: 'BAD_REQUEST', message: 'lat, lng, k must be numbers' } }, 400);
  }
  const gi = getGeoIntelligence();
  const nearest = gi.spatialIndex.nearestParcels(lat, lng, k);
  return c.json({ success: true, data: { count: nearest.length, parcels: nearest } });
});

export default router;
