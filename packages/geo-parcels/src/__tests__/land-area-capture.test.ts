import { describe, expect, it, vi } from 'vitest';

import { captureLandArea } from '../land-area-capture.js';
import { logger } from '../logger.js';
import { GeoParcelsError } from '../types.js';
import {
  InMemoryPort,
  TEST_LAND_AREA_POLYGON,
} from './in-memory-port.js';

describe('captureLandArea', () => {
  it('persists a land area with computed centroid + area', async () => {
    const port = new InMemoryPort();
    const result = await captureLandArea(port, {
      id: 'la1',
      tenant_id: 't1',
      display_name: 'Kariakoo plot 27',
      boundary_polygon: TEST_LAND_AREA_POLYGON,
      jurisdiction: 'TZ',
      captured_via: 'gps_walk',
      captured_by_user_id: 'u1',
    });
    expect(result.id).toBe('la1');
    expect(result.center_point.type).toBe('Point');
    expect(result.area_sqm).toBeGreaterThan(0);
    expect(result.captured_via).toBe('gps_walk');

    const stored = await port.getLandArea('la1', 't1');
    expect(stored?.display_name).toBe('Kariakoo plot 27');
  });

  it('rejects polygon with unclosed outer ring', async () => {
    const port = new InMemoryPort();
    const open = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [39.270, -6.821],
          [39.272, -6.821],
          [39.272, -6.819],
          [39.270, -6.819],
          // Intentionally NOT closing back to start.
          [39.270, -6.820],
        ],
      ],
    };
    await expect(
      captureLandArea(port, {
        id: 'la2',
        tenant_id: 't1',
        display_name: 'bad',
        boundary_polygon: open,
        jurisdiction: 'TZ',
        captured_via: 'manual_draw',
        captured_by_user_id: 'u1',
      }),
    ).rejects.toThrow(GeoParcelsError);
  });

  it('rejects polygon with fewer than 4 points', async () => {
    const port = new InMemoryPort();
    const tooFew = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [39.270, -6.821],
          [39.272, -6.821],
          [39.270, -6.821],
        ],
      ],
    };
    await expect(
      captureLandArea(port, {
        id: 'la3',
        tenant_id: 't1',
        display_name: 'bad',
        boundary_polygon: tooFew,
        jurisdiction: 'TZ',
        captured_via: 'manual_draw',
        captured_by_user_id: 'u1',
      }),
    ).rejects.toThrow(GeoParcelsError);
  });

  it('rejects invalid jurisdiction (not 2 letters)', async () => {
    const port = new InMemoryPort();
    await expect(
      captureLandArea(port, {
        id: 'la4',
        tenant_id: 't1',
        display_name: 'bad',
        boundary_polygon: TEST_LAND_AREA_POLYGON,
        jurisdiction: 'TZA',
        captured_via: 'manual_draw',
        captured_by_user_id: 'u1',
      }),
    ).rejects.toThrow(GeoParcelsError);
  });

  it('uses reverse geocoder to fill region/ward when missing', async () => {
    const port = new InMemoryPort();
    const geocoder = {
      resolve: vi
        .fn()
        .mockResolvedValue({ region: 'Dar es Salaam', ward: 'Kariakoo' }),
    };
    const result = await captureLandArea(
      port,
      {
        id: 'la5',
        tenant_id: 't1',
        display_name: 'Site',
        boundary_polygon: TEST_LAND_AREA_POLYGON,
        jurisdiction: 'TZ',
        captured_via: 'gps_walk',
        captured_by_user_id: 'u1',
      },
      geocoder,
    );
    expect(result.region).toBe('Dar es Salaam');
    expect(result.ward).toBe('Kariakoo');
    expect(geocoder.resolve).toHaveBeenCalledTimes(1);
  });

  it('continues silently if reverse geocoder throws', async () => {
    const port = new InMemoryPort();
    const loggerSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const geocoder = {
      resolve: vi.fn().mockRejectedValue(new Error('network down')),
    };
    const result = await captureLandArea(
      port,
      {
        id: 'la6',
        tenant_id: 't1',
        display_name: 'Site',
        boundary_polygon: TEST_LAND_AREA_POLYGON,
        jurisdiction: 'TZ',
        captured_via: 'gps_walk',
        captured_by_user_id: 'u1',
      },
      geocoder,
    );
    expect(result.id).toBe('la6');
    expect(loggerSpy).toHaveBeenCalled();
    loggerSpy.mockRestore();
  });

  it('does not call geocoder when region+ward already provided', async () => {
    const port = new InMemoryPort();
    const geocoder = {
      resolve: vi.fn(),
    };
    await captureLandArea(
      port,
      {
        id: 'la7',
        tenant_id: 't1',
        display_name: 'Site',
        boundary_polygon: TEST_LAND_AREA_POLYGON,
        region: 'Dar es Salaam',
        ward: 'Kariakoo',
        jurisdiction: 'TZ',
        captured_via: 'gps_walk',
        captured_by_user_id: 'u1',
      },
      geocoder,
    );
    expect(geocoder.resolve).not.toHaveBeenCalled();
  });
});
