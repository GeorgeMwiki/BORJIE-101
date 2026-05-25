import { describe, it, expect } from 'vitest';
import { polygonDrawPolicy } from '../policies/polygon-draw-policy.js';
import { makeReq } from './fixtures.js';

describe('polygonDrawPolicy', () => {
  it('preChecks rejects < 3 vertices', () => {
    const issues = polygonDrawPolicy.preChecks(
      makeReq('polygon_draw', { polygon: { vertices: [{ lat: 0, lng: 0 }] } }),
    );
    expect(issues.some((i) => i.code === 'polygon.vertices.too_few')).toBe(true);
  });

  it('preChecks accepts a triangle', () => {
    const issues = polygonDrawPolicy.preChecks(
      makeReq('polygon_draw', {
        polygon: {
          vertices: [
            { lat: 0, lng: 0 },
            { lat: 0, lng: 1 },
            { lat: 1, lng: 0 },
          ],
        },
      }),
    );
    expect(issues).toEqual([]);
  });

  it('preChecks reports out-of-range coordinates', () => {
    const issues = polygonDrawPolicy.preChecks(
      makeReq('polygon_draw', {
        polygon: {
          vertices: [
            { lat: 91, lng: 0 },
            { lat: 0, lng: 0 },
            { lat: 0, lng: 1 },
          ],
        },
      }),
    );
    expect(issues.some((i) => i.code === 'polygon.coordinates.out_of_range')).toBe(true);
  });

  it('redLines triggers on polygon span > 0.5°', () => {
    const redLines = polygonDrawPolicy.redLines(
      makeReq('polygon_draw', {
        polygon: {
          vertices: [
            { lat: 0, lng: 0 },
            { lat: 1, lng: 0 },
            { lat: 0, lng: 1 },
          ],
        },
      }),
    );
    expect(redLines.some((i) => i.code === 'polygon.span.too_large')).toBe(true);
  });

  it('redLines triggers when declared area > envelope * 1.05', () => {
    const redLines = polygonDrawPolicy.redLines(
      makeReq('polygon_draw', {
        polygon: {
          vertices: [
            { lat: 0, lng: 0 },
            { lat: 0, lng: 0.001 },
            { lat: 0.001, lng: 0 },
          ],
          declaredAreaSqm: 1000,
        },
        propertyEnvelopeAreaSqm: 100,
      }),
    );
    expect(redLines.some((i) => i.code === 'polygon.area.exceeds_envelope')).toBe(true);
  });

  it('brainPrompt summarises the vertex count', () => {
    const prompt = polygonDrawPolicy.brainPrompt(
      makeReq('polygon_draw', {
        polygon: {
          vertices: [
            { lat: 0, lng: 0 },
            { lat: 0, lng: 0.001 },
            { lat: 0.001, lng: 0 },
          ],
        },
      }),
    );
    expect(prompt).toContain('3 vertices');
  });
});
