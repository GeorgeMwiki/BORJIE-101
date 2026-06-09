/**
 * Owner-onboarding tabular-sample parsers (STRETCH).
 *
 * Sites (GeoJSON) + drill holes (CSV) are not document mimes, so they cannot
 * ride the OCR bridge. These pure parsers shape the bytes into the gateway's
 * `TabularSample` so the recipe `/commit` `sample` path can create real
 * `sites` / `drill_holes` rows. We pin the parse contract here.
 */
import { describe, expect, it } from 'vitest';
import {
  geoJsonToSites,
  csvToDrillHoles,
} from '../queries/onboarding-ingest';

describe('geoJsonToSites', () => {
  it('maps each feature.properties into a row keyed by the union of keys', () => {
    const fc = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { name: 'North Pit', mineral: 'gold' } },
        { type: 'Feature', properties: { name: 'South Pit', phase: 'active' } },
      ],
    });
    const sample = geoJsonToSites('sites.geojson', fc);
    expect(sample).not.toBeNull();
    expect(sample!.total_row_count).toBe(2);
    expect(sample!.headers).toEqual(expect.arrayContaining(['name', 'mineral', 'phase']));
    // North Pit row has its name in the name column.
    const nameCol = sample!.headers.indexOf('name');
    expect(sample!.rows[0]![nameCol]).toBe('North Pit');
  });

  it('returns null for non-GeoJSON / empty feature collections', () => {
    expect(geoJsonToSites('x.geojson', 'not json')).toBeNull();
    expect(
      geoJsonToSites('x.geojson', JSON.stringify({ type: 'FeatureCollection', features: [] })),
    ).toBeNull();
  });
});

describe('csvToDrillHoles', () => {
  it('parses a header + data rows into a TabularSample', () => {
    const csv = ['hole_id,kind,total_depth_m', 'DH-001,exploration,120.5', 'DH-002,grade_control,80'].join(
      '\n',
    );
    const sample = csvToDrillHoles('drill.csv', csv);
    expect(sample).not.toBeNull();
    expect(sample!.headers).toEqual(['hole_id', 'kind', 'total_depth_m']);
    expect(sample!.total_row_count).toBe(2);
    expect(sample!.rows[0]).toEqual(['DH-001', 'exploration', '120.5']);
  });

  it('honours simple double-quoted fields with embedded commas', () => {
    const csv = ['hole_id,note', 'DH-003,"deep, vertical"'].join('\n');
    const sample = csvToDrillHoles('drill.csv', csv);
    expect(sample!.rows[0]).toEqual(['DH-003', 'deep, vertical']);
  });

  it('returns null when there is no data row', () => {
    expect(csvToDrillHoles('drill.csv', 'hole_id,kind')).toBeNull();
    expect(csvToDrillHoles('drill.csv', '')).toBeNull();
  });
});
