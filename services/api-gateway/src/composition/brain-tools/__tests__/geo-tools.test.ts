/**
 * geo-tools tests — drives the 5 geo brain tools with an in-memory
 * httpClient double so we never touch a real api-gateway.
 *
 * Covers:
 *   - geoSiteNearbyTool input radius cap + client-side filter
 *   - geoTitleContainsTool maps absence to inside=false
 *   - geoHazardProximityTool risk score ladder
 *   - geoComplianceZoneTool optional authority filter
 *   - geoRouteOptimizeTool degraded-mode fallback
 *   - GEO_TOOLS catalog has exactly 5 entries with the right ids
 */

import { describe, it, expect, vi } from 'vitest';
import {
  geoSiteNearbyTool,
  geoTitleContainsTool,
  geoHazardProximityTool,
  geoComplianceZoneTool,
  geoRouteOptimizeTool,
  GEO_TOOLS,
} from '../geo-tools.js';

const CTX = {
  tenantId: 'tenant-acme',
  actorId: 'user-mwikila',
  personaSlug: 'T1_owner_strategist',
};

function makeClient(getResult: unknown) {
  return {
    get: vi.fn(async () => getResult),
    post: vi.fn(async () => ({})),
  };
}

describe('geoSiteNearbyTool', () => {
  it('filters out sites beyond the radius cap', async () => {
    const client = makeClient({
      data: {
        sites: [
          { siteId: 's1', siteName: 'Pit A', distanceMeters: 10_000 },
          { siteId: 's2', siteName: 'Pit B', distanceMeters: 60_000 },
        ],
      },
    });
    const result = await geoSiteNearbyTool.handler(
      { lat: -6.8, lon: 39.2, radiusKm: 50, limit: 20 },
      { ...CTX, httpClient: client },
    );
    expect(result.sites.map((s) => s.siteId)).toEqual(['s1']);
  });

  it('returns empty list when client is absent (degraded mode)', async () => {
    const result = await geoSiteNearbyTool.handler(
      { lat: -6.8, lon: 39.2, radiusKm: 50, limit: 20 },
      CTX,
    );
    expect(result.sites).toEqual([]);
  });
});

describe('geoTitleContainsTool', () => {
  it('maps absence of licence to inside=false', async () => {
    const client = makeClient({ data: { licence: null } });
    const result = await geoTitleContainsTool.handler(
      { lat: -6.8, lon: 39.2 },
      { ...CTX, httpClient: client },
    );
    expect(result.inside).toBe(false);
    expect(result.licence).toBeNull();
  });

  it('reports inside=true when licence row returned', async () => {
    const client = makeClient({
      data: {
        licence: {
          licenceId: 'l1',
          kind: 'PML',
          number: 'PML/123/2024',
          mineral: 'Au',
          companyId: 'c1',
        },
      },
    });
    const result = await geoTitleContainsTool.handler(
      { lat: -6.8, lon: 39.2 },
      { ...CTX, httpClient: client },
    );
    expect(result.inside).toBe(true);
    expect(result.licence?.kind).toBe('PML');
  });
});

describe('geoHazardProximityTool', () => {
  it('returns 100 when inside a forbidden hazard', async () => {
    const client = makeClient({
      data: {
        hazards: [
          {
            hazardId: 'h1',
            nameSw: 'Marufuku',
            nameEn: 'Forbidden',
            severity: 'forbidden',
            category: 'magazine',
            siteId: null,
          },
        ],
      },
    });
    const result = await geoHazardProximityTool.handler(
      { lat: -6.8, lon: 39.2 },
      { ...CTX, httpClient: client },
    );
    expect(result.riskScore).toBe(100);
    expect(result.insideForbidden).toBe(true);
  });

  it('returns 60 when inside caution only', async () => {
    const client = makeClient({
      data: {
        hazards: [
          {
            hazardId: 'h1',
            nameSw: 'Tahadhari',
            nameEn: 'Caution',
            severity: 'caution',
            category: 'flood_plain',
            siteId: null,
          },
        ],
      },
    });
    const result = await geoHazardProximityTool.handler(
      { lat: -6.8, lon: 39.2 },
      { ...CTX, httpClient: client },
    );
    expect(result.riskScore).toBe(60);
    expect(result.insideForbidden).toBe(false);
  });

  it('returns 0 with no hazards', async () => {
    const client = makeClient({ data: { hazards: [] } });
    const result = await geoHazardProximityTool.handler(
      { lat: -6.8, lon: 39.2 },
      { ...CTX, httpClient: client },
    );
    expect(result.riskScore).toBe(0);
  });
});

describe('geoComplianceZoneTool', () => {
  it('passes optional authority filter to client', async () => {
    const client = makeClient({
      data: {
        zones: [
          {
            zoneId: 'z1',
            authority: 'eiti',
            nameSw: 'Mbeya',
            nameEn: 'Mbeya',
            code: 'MBY',
            attributes: { teiti_zone: 'MBY' },
          },
        ],
      },
    });
    const result = await geoComplianceZoneTool.handler(
      { lat: -8.0, lon: 33.0, authority: 'eiti' },
      { ...CTX, httpClient: client },
    );
    expect(result.zones[0]?.authority).toBe('eiti');
    expect(client.get).toHaveBeenCalledWith(
      '/regulatory/zones/by-point',
      expect.objectContaining({
        query: expect.objectContaining({ authority: 'eiti' }),
      }),
    );
  });
});

describe('geoRouteOptimizeTool', () => {
  it('returns degraded-mode fallback when no client', async () => {
    const result = await geoRouteOptimizeTool.handler(
      { from: { lat: -6.8, lon: 39.2 }, to: { lat: -3.4, lon: 36.7 } },
      CTX,
    );
    expect(result.distanceMeters).toBe(0);
    expect(result.wetSeasonPenalty).toBe(1);
    expect(result.note).toMatch(/degraded/);
  });

  it('forwards month override to client', async () => {
    const client = makeClient({
      data: {
        distanceMeters: 470_000,
        estimatedMinutes: 700,
        wetSeasonPenalty: 1.35,
        note: 'wet',
      },
    });
    const result = await geoRouteOptimizeTool.handler(
      {
        from: { lat: -6.8, lon: 39.2 },
        to: { lat: -3.4, lon: 36.7 },
        month: 4,
      },
      { ...CTX, httpClient: client },
    );
    expect(result.distanceMeters).toBe(470_000);
    expect(client.get).toHaveBeenCalledWith(
      '/mining/portfolio-map/route-estimate',
      expect.objectContaining({ query: expect.objectContaining({ month: 4 }) }),
    );
  });
});

describe('GEO_TOOLS catalog', () => {
  it('contains exactly 5 tools with the expected ids', () => {
    expect(GEO_TOOLS.length).toBe(5);
    expect(GEO_TOOLS.map((t) => t.id).sort()).toEqual([
      'mining.geo.compliance.zone_of',
      'mining.geo.hazard.proximity',
      'mining.geo.route.optimize',
      'mining.geo.site.nearby',
      'mining.geo.title.contains',
    ]);
  });

  it('marks every tool LOW stakes + read-only', () => {
    for (const tool of GEO_TOOLS) {
      expect(tool.stakes).toBe('LOW');
      expect(tool.isWrite).toBe(false);
      expect(tool.requiresPolicyRuleLiteral).toBe(false);
    }
  });
});
