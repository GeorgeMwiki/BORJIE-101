/**
 * Geo brain tools — 5 tools surfacing the geofencing service.
 *
 * Companion to:
 *   - services/api-gateway/src/services/geofencing/
 *   - packages/database/src/migrations/0130_postgis.sql
 *   - Docs/RESEARCH/GEO_SOTA_2026-05-29.md §6
 *
 * Catalogue:
 *   - mining.geo.site.nearby          (owner/manager)
 *   - mining.geo.title.contains       (owner/admin)
 *   - mining.geo.hazard.proximity     (manager/worker)
 *   - mining.geo.compliance.zone_of   (owner/admin)
 *   - mining.geo.route.optimize       (manager)
 *
 * All five are READ tools, persona-gated, no audit chain (READ stakes
 * = LOW). The handlers call the brain's loopback HTTP client to hit
 * the geo endpoints owned by the api-gateway, so the same auth +
 * tenant binding apply.
 */

import { z } from 'zod';
import type { PersonaToolDescriptor } from './types.js';

const OWNER_MANAGER: ReadonlyArray<
  'T1_owner_strategist' | 'T3_module_manager'
> = ['T1_owner_strategist', 'T3_module_manager'];

const OWNER_ADMIN: ReadonlyArray<
  'T1_owner_strategist' | 'T2_admin_strategist'
> = ['T1_owner_strategist', 'T2_admin_strategist'];

const MANAGER_WORKER: ReadonlyArray<
  'T3_module_manager' | 'T4_field_employee'
> = ['T3_module_manager', 'T4_field_employee'];

const MANAGER_ONLY: ReadonlyArray<'T3_module_manager'> = ['T3_module_manager'];

const PointInput = z.object({
  lat: z.number().gte(-90).lte(90),
  lon: z.number().gte(-180).lte(180),
});

// ---------------------------------------------------------------------------
// 1. mining.geo.site.nearby — owner's sites within R km of a point
// ---------------------------------------------------------------------------

const SiteNearbyInput = PointInput.extend({
  radiusKm: z.number().positive().max(1000).default(50),
  limit: z.number().int().positive().max(50).default(20),
});

const SiteNearbyOutput = z.object({
  sites: z.array(
    z.object({
      siteId: z.string(),
      siteName: z.string(),
      distanceMeters: z.number(),
    }),
  ),
  point: PointInput,
});

export const geoSiteNearbyTool: PersonaToolDescriptor<
  typeof SiteNearbyInput,
  typeof SiteNearbyOutput
> = {
  id: 'mining.geo.site.nearby',
  name: 'Geo — sites near point',
  description:
    "Return the owner's mining sites within R km of the supplied point. " +
    'Read-only. Uses PostGIS distance-to-nearest. Persona-gated to owner / manager.',
  personaSlugs: OWNER_MANAGER,
  inputSchema: SiteNearbyInput,
  outputSchema: SiteNearbyOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return { sites: [], point: { lat: input.lat, lon: input.lon } };
    }
    const res = await client.get<{
      data?: {
        sites?: Array<{
          siteId: string;
          siteName: string;
          distanceMeters: number;
        }>;
      };
    }>('/mining/portfolio-map/nearest-sites', {
      query: {
        tenantId: ctx.tenantId,
        lat: input.lat,
        lon: input.lon,
        radiusKm: input.radiusKm,
        limit: input.limit,
      },
    });
    const sites = res.data?.sites ?? [];
    // Belt-and-braces filter — even if the endpoint forgets, we
    // honour the radius cap client-side.
    const radiusMeters = input.radiusKm * 1000;
    return {
      sites: sites.filter((s) => s.distanceMeters <= radiusMeters),
      point: { lat: input.lat, lon: input.lon },
    };
  },
};

// ---------------------------------------------------------------------------
// 2. mining.geo.title.contains — does a point fall inside any licence polygon
// ---------------------------------------------------------------------------

const TitleContainsInput = PointInput;
const TitleContainsOutput = z.object({
  inside: z.boolean(),
  licence: z
    .object({
      licenceId: z.string(),
      kind: z.string(),
      number: z.string(),
      mineral: z.string(),
      companyId: z.string(),
    })
    .nullable(),
  point: PointInput,
});

export const geoTitleContainsTool: PersonaToolDescriptor<
  typeof TitleContainsInput,
  typeof TitleContainsOutput
> = {
  id: 'mining.geo.title.contains',
  name: 'Geo — point inside mining title?',
  description:
    "Check whether the supplied point falls inside any of the owner's mining title " +
    '(licence) polygons. Used for trespass detection and royalty allocation. Read-only.',
  personaSlugs: OWNER_ADMIN,
  inputSchema: TitleContainsInput,
  outputSchema: TitleContainsOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        inside: false,
        licence: null,
        point: { lat: input.lat, lon: input.lon },
      };
    }
    const res = await client.get<{
      data?: {
        licence?: {
          licenceId: string;
          kind: string;
          number: string;
          mineral: string;
          companyId: string;
        } | null;
      };
    }>('/mining/portfolio-map/title-contains', {
      query: { tenantId: ctx.tenantId, lat: input.lat, lon: input.lon },
    });
    const licence = res.data?.licence ?? null;
    return {
      inside: licence !== null,
      licence,
      point: { lat: input.lat, lon: input.lon },
    };
  },
};

// ---------------------------------------------------------------------------
// 3. mining.geo.hazard.proximity — risk score from nearest hazard distance
// ---------------------------------------------------------------------------

const HazardProximityInput = PointInput;
const HazardProximityOutput = z.object({
  point: PointInput,
  riskScore: z.number().min(0).max(100),
  hazards: z.array(
    z.object({
      hazardId: z.string(),
      nameSw: z.string(),
      nameEn: z.string(),
      severity: z.enum(['work_zone', 'caution', 'forbidden']),
      category: z.string(),
      siteId: z.string().nullable(),
    }),
  ),
  insideForbidden: z.boolean(),
});

export const geoHazardProximityTool: PersonaToolDescriptor<
  typeof HazardProximityInput,
  typeof HazardProximityOutput
> = {
  id: 'mining.geo.hazard.proximity',
  name: 'Geo — hazard proximity',
  description:
    'Return every hazard polygon that contains the point plus a 0–100 risk score. ' +
    'Forbidden = 100, caution = 60, work_zone = 10, no hits = 0. Persona-gated to manager / worker.',
  personaSlugs: MANAGER_WORKER,
  inputSchema: HazardProximityInput,
  outputSchema: HazardProximityOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        point: { lat: input.lat, lon: input.lon },
        riskScore: 0,
        hazards: [],
        insideForbidden: false,
      };
    }
    const res = await client.get<{
      data?: {
        hazards?: Array<{
          hazardId: string;
          nameSw: string;
          nameEn: string;
          severity: 'work_zone' | 'caution' | 'forbidden';
          category: string;
          siteId: string | null;
        }>;
      };
    }>('/mining/hazard-zones/at-point', {
      query: { tenantId: ctx.tenantId, lat: input.lat, lon: input.lon },
    });
    const hazards = res.data?.hazards ?? [];
    const score = hazards.reduce((acc, h) => {
      if (h.severity === 'forbidden') return Math.max(acc, 100);
      if (h.severity === 'caution') return Math.max(acc, 60);
      return Math.max(acc, 10);
    }, 0);
    return {
      point: { lat: input.lat, lon: input.lon },
      riskScore: score,
      hazards,
      insideForbidden: hazards.some((h) => h.severity === 'forbidden'),
    };
  },
};

// ---------------------------------------------------------------------------
// 4. mining.geo.compliance.zone_of — PCCB / NEMC / EITI zone of point
// ---------------------------------------------------------------------------

const ComplianceZoneInput = PointInput.extend({
  authority: z.enum(['pccb', 'nemc', 'eiti']).optional(),
});

const ComplianceZoneOutput = z.object({
  point: PointInput,
  zones: z.array(
    z.object({
      zoneId: z.string(),
      authority: z.enum(['pccb', 'nemc', 'eiti']),
      nameSw: z.string(),
      nameEn: z.string(),
      code: z.string(),
      attributes: z.record(z.any()),
    }),
  ),
  count: z.number().int().nonnegative(),
});

export const geoComplianceZoneTool: PersonaToolDescriptor<
  typeof ComplianceZoneInput,
  typeof ComplianceZoneOutput
> = {
  id: 'mining.geo.compliance.zone_of',
  name: 'Geo — regulatory zone of point',
  description:
    'Return the Tanzania PCCB region + NEMC catchment + EITI small-scale mining zone ' +
    'that contain the supplied point. Optional authority filter (pccb|nemc|eiti). ' +
    'Tenant-agnostic; auth-required.',
  personaSlugs: OWNER_ADMIN,
  inputSchema: ComplianceZoneInput,
  outputSchema: ComplianceZoneOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        point: { lat: input.lat, lon: input.lon },
        zones: [],
        count: 0,
      };
    }
    const query: Record<string, string | number> = {
      lat: input.lat,
      lon: input.lon,
    };
    if (input.authority) query.authority = input.authority;
    const res = await client.get<{
      data?: {
        point?: { lat: number; lon: number };
        zones?: Array<{
          zoneId: string;
          authority: 'pccb' | 'nemc' | 'eiti';
          nameSw: string;
          nameEn: string;
          code: string;
          attributes: Record<string, unknown>;
        }>;
        count?: number;
      };
    }>('/regulatory/zones/by-point', { query });
    const zones = res.data?.zones ?? [];
    return {
      point: { lat: input.lat, lon: input.lon },
      zones,
      count: zones.length,
    };
  },
};

// ---------------------------------------------------------------------------
// 5. mining.geo.route.optimize — Tanzania-aware A→B distance + ETA
// ---------------------------------------------------------------------------

const RouteOptimizeInput = z.object({
  from: PointInput,
  to: PointInput,
  month: z.number().int().min(1).max(12).optional(),
});

const RouteOptimizeOutput = z.object({
  distanceMeters: z.number(),
  estimatedMinutes: z.number(),
  wetSeasonPenalty: z.number(),
  note: z.string(),
});

export const geoRouteOptimizeTool: PersonaToolDescriptor<
  typeof RouteOptimizeInput,
  typeof RouteOptimizeOutput
> = {
  id: 'mining.geo.route.optimize',
  name: 'Geo — Tanzania-aware route',
  description:
    'Return distance + ETA from A to B with a Tanzania wet-season penalty applied ' +
    '(March-May + Nov-Dec rains). Phase-1 stub: haversine + season factor; Phase-2 ' +
    'swaps in an OSRM build with per-season edge weights.',
  personaSlugs: MANAGER_ONLY,
  inputSchema: RouteOptimizeInput,
  outputSchema: RouteOptimizeOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        distanceMeters: 0,
        estimatedMinutes: 0,
        wetSeasonPenalty: 1,
        note: 'route optimizer unavailable in degraded mode',
      };
    }
    const query: Record<string, string | number> = {
      tenantId: ctx.tenantId,
      fromLat: input.from.lat,
      fromLon: input.from.lon,
      toLat: input.to.lat,
      toLon: input.to.lon,
    };
    if (input.month !== undefined) query.month = input.month;
    const res = await client.get<{
      data?: {
        distanceMeters?: number;
        estimatedMinutes?: number;
        wetSeasonPenalty?: number;
        note?: string;
      };
    }>('/mining/portfolio-map/route-estimate', { query });
    const data = res.data ?? {};
    return {
      distanceMeters: Number(data.distanceMeters ?? 0),
      estimatedMinutes: Number(data.estimatedMinutes ?? 0),
      wetSeasonPenalty: Number(data.wetSeasonPenalty ?? 1),
      note: String(data.note ?? ''),
    };
  },
};

// ---------------------------------------------------------------------------
// Catalog export — wired into composition/brain-tools/index.ts.
// ---------------------------------------------------------------------------

export const GEO_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  geoSiteNearbyTool,
  geoTitleContainsTool,
  geoHazardProximityTool,
  geoComplianceZoneTool,
  geoRouteOptimizeTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
