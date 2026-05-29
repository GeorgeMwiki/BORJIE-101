/**
 * @borjie/maps type-helper tests.
 *
 * Covers the pure helpers — pickLabel, resolveStyleUrl, boundsOf,
 * fromGeoJsonPolygon — which the React + RN components both depend
 * on.
 */

import { describe, it, expect } from 'vitest';
import {
  BORJIE_DEFAULT_STYLE_URL,
  boundsOf,
  fromGeoJsonPolygon,
  pickLabel,
  resolveStyleUrl,
} from '../types/index.js';

describe('pickLabel', () => {
  it('returns the active locale label', () => {
    expect(pickLabel({ sw: 'Tovuti', en: 'Site' }, 'sw')).toBe('Tovuti');
    expect(pickLabel({ sw: 'Tovuti', en: 'Site' }, 'en')).toBe('Site');
  });

  it('returns undefined when label is missing', () => {
    expect(pickLabel(undefined, 'sw')).toBeUndefined();
  });
});

describe('resolveStyleUrl', () => {
  it('returns the default for an empty config', () => {
    expect(resolveStyleUrl({})).toBe(BORJIE_DEFAULT_STYLE_URL);
  });

  it('honours an explicit override', () => {
    expect(resolveStyleUrl({ styleUrlOverride: 'https://x.example/style' })).toBe(
      'https://x.example/style',
    );
  });

  it('returns a satellite URL when theme=satellite', () => {
    const url = resolveStyleUrl({ theme: 'satellite', locale: 'sw' });
    expect(url).toMatch(/satellite/);
  });
});

describe('boundsOf', () => {
  it('returns null when no features given', () => {
    expect(boundsOf([], [], [])).toBeNull();
  });

  it('computes the enclosing bbox over markers + polygons + polylines', () => {
    const bounds = boundsOf(
      [
        {
          id: 'm1',
          position: { lng: 39.2, lat: -6.8 },
          layerKind: 'site',
        },
      ],
      [
        {
          id: 'p1',
          coordinates: [
            [
              [36.7, -3.4] as const,
              [36.8, -3.4] as const,
              [36.8, -3.5] as const,
              [36.7, -3.5] as const,
              [36.7, -3.4] as const,
            ],
          ],
          layerKind: 'licence',
        },
      ],
      [
        {
          id: 'l1',
          coordinates: [
            [39.2, -6.8] as const,
            [36.8, -3.4] as const,
          ],
          layerKind: 'route',
        },
      ],
    );
    expect(bounds).not.toBeNull();
    expect(bounds!.southWest.lng).toBeCloseTo(36.7);
    expect(bounds!.southWest.lat).toBeCloseTo(-6.8);
    expect(bounds!.northEast.lng).toBeCloseTo(39.2);
    expect(bounds!.northEast.lat).toBeCloseTo(-3.4);
  });
});

describe('fromGeoJsonPolygon', () => {
  it('parses a GeoJSON polygon string into a BorjiePolygon', () => {
    const raw =
      '{"type":"Polygon","coordinates":[[[39.2,-6.8],[39.3,-6.8],[39.3,-6.9],[39.2,-6.9],[39.2,-6.8]]]}';
    const polygon = fromGeoJsonPolygon(raw, 'p1', 'site');
    expect(polygon?.id).toBe('p1');
    expect(polygon?.coordinates[0]?.length).toBe(5);
  });

  it('returns null for non-Polygon types', () => {
    const raw = '{"type":"Point","coordinates":[39.2,-6.8]}';
    expect(fromGeoJsonPolygon(raw, 'p1', 'site')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(fromGeoJsonPolygon('{not json', 'p1', 'site')).toBeNull();
  });

  it('returns null for null / undefined input', () => {
    expect(fromGeoJsonPolygon(null, 'p1', 'site')).toBeNull();
    expect(fromGeoJsonPolygon(undefined, 'p1', 'site')).toBeNull();
  });

  it('accepts an already-parsed object', () => {
    const parsed = {
      type: 'Polygon',
      coordinates: [
        [
          [39.2, -6.8],
          [39.3, -6.8],
          [39.3, -6.9],
          [39.2, -6.9],
          [39.2, -6.8],
        ],
      ],
    };
    const polygon = fromGeoJsonPolygon(parsed, 'p1', 'hazard', {
      sw: 'Tahadhari',
      en: 'Caution',
    });
    expect(polygon?.label?.sw).toBe('Tahadhari');
  });

  it('drops malformed rings', () => {
    const raw =
      '{"type":"Polygon","coordinates":[[[39.2,-6.8],[39.3,-6.8]]]}';
    expect(fromGeoJsonPolygon(raw, 'p1', 'site')).toBeNull();
  });
});
