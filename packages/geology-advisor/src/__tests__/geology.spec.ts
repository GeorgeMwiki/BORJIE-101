/**
 * Happy-path tests for the geology advisor.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createGeologyAdvisor,
  compositeIntervals,
  type GeologyInput,
} from '../index.js';

const SAMPLE_INPUT: GeologyInput = {
  collars: [
    {
      holeId: 'DH-001',
      collar: [0, 0, 100],
      azimuthDeg: 90,
      dipDeg: -60,
      totalDepthM: 120,
    },
    {
      holeId: 'DH-002',
      collar: [10, 0, 100],
      azimuthDeg: 90,
      dipDeg: -60,
      totalDepthM: 130,
    },
  ],
  assays: [
    { holeId: 'DH-001', fromM: 20, toM: 25, grade: 3.5, density: 2.7 },
    { holeId: 'DH-001', fromM: 25, toM: 30, grade: 4.0, density: 2.7 },
    { holeId: 'DH-002', fromM: 30, toM: 40, grade: 2.0, density: 2.7 },
  ],
  veinSamples: [
    { point: [0, 0, 80], grade: 3.0 },
    { point: [10, 0, 80], grade: 2.5 },
    { point: [5, 5, 80], grade: 3.2 },
    { point: [5, -5, 80], grade: 2.8 },
  ],
  cutoffGrade: 1.5,
};

describe('geology-advisor.analyze', () => {
  it('composites intervals, triangulates the vein, and produces stats', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const advisor = createGeologyAdvisor({ logger });
    const result = await advisor.analyze(SAMPLE_INPUT);
    expect(result.composited.length).toBe(2);
    expect(result.veinMesh).not.toBeNull();
    expect(result.veinMesh?.triangles.length).toBeGreaterThan(0);
    expect(result.stats.totalTonnes).toBeGreaterThan(0);
  });

  it('compositeIntervals returns weighted grade per hole', () => {
    const c = compositeIntervals([
      { holeId: 'H1', fromM: 0, toM: 5, grade: 4.0, density: 2.7 },
      { holeId: 'H1', fromM: 5, toM: 15, grade: 2.0, density: 2.7 },
    ]);
    // Weighted: (4*5 + 2*10) / 15 = 40/15 = 2.666...
    expect(c[0]?.weightedGrade).toBeCloseTo(2.6667, 3);
  });
});

describe('geology-advisor.recommend', () => {
  it('flags low-confidence volume when too few holes support the assays', async () => {
    const advisor = createGeologyAdvisor();
    const slim: GeologyInput = {
      ...SAMPLE_INPUT,
      assays: [{ holeId: 'DH-X', fromM: 0, toM: 5, grade: 2.0, density: 2.7 }],
    };
    const analysis = await advisor.analyze(slim);
    const recs = await advisor.recommend({
      input: slim,
      analysis,
      policy: { minSamplesPerVein: 3, minHolesPerArea: 3 },
    });
    expect(recs.some((r) => r.kind === 'flag-low-confidence-volume')).toBe(true);
  });
});
