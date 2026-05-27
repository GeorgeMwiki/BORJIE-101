/**
 * Mining-domain wrappers — end-to-end "Mr. Mwikila" call shapes.
 */

import { describe as suite, it, expect } from 'vitest';
import {
  sitePerformanceStats,
  royaltyRateAnalysis,
  safetyIncidentCorrelation,
  buyerCohortAnalysis,
} from '../domain/mining-stats.js';

suite('domain — Mr. Mwikila wrappers', () => {
  it('sitePerformanceStats returns a descriptive summary and a bootstrap CI', () => {
    const throughput = [120, 130, 125, 140, 110, 135, 128, 132, 118, 145];
    const r = sitePerformanceStats('PIT-A', throughput, { seed: 42 });
    expect(r.siteId).toBe('PIT-A');
    expect(r.nDays).toBe(10);
    expect(r.summary.mean).toBeCloseTo(128.3, 1);
    expect(r.meanCi95.low).toBeLessThan(r.summary.mean);
    expect(r.meanCi95.high).toBeGreaterThan(r.summary.mean);
  });

  it('royaltyRateAnalysis reports percent change and a Welch t-test', () => {
    const before = [3.2, 3.1, 3.3, 3.2, 3.0, 3.1, 3.2, 3.1, 3.3, 3.2];
    const after = [3.6, 3.7, 3.8, 3.7, 3.5, 3.6, 3.7, 3.8, 3.6, 3.7];
    const r = royaltyRateAnalysis(before, after);
    expect(r.meanBefore).toBeCloseTo(3.17, 2);
    expect(r.meanAfter).toBeCloseTo(3.67, 2);
    expect(r.percentChange).toBeGreaterThan(0.1);  // ~15.8% increase
    expect(r.test.testName).toBe("Welch's t-test");
    expect(r.test.rejectH0).toBe(true);
    expect(r.cohenD).toBeGreaterThan(0); // after > before
  });

  it('safetyIncidentCorrelation returns Pearson, Spearman, and chi-square', () => {
    const incidents = [3, 5, 7, 9, 11, 13];
    const driver = [10, 15, 20, 25, 30, 35]; // perfectly correlated
    const contingency = [
      [12, 8],
      [3, 17],
    ]; // strong association
    const r = safetyIncidentCorrelation(incidents, driver, contingency);
    expect(r.pearsonR).toBeCloseTo(1, 6);
    expect(r.spearmanR).toBeCloseTo(1, 6);
    expect(r.chiSquare).toBeDefined();
    expect((r.chiSquare?.rejectH0 ?? false)).toBe(true);
  });

  it('buyerCohortAnalysis returns k clusters and a silhouette > 0.5', () => {
    const features = [
      [1, 1], [1.1, 0.9], [0.9, 1.1], [1.0, 1.0],
      [10, 10], [10.1, 9.9], [9.9, 10.1], [10.0, 10.0],
      [-5, -5], [-5.1, -4.9], [-4.9, -5.1], [-5.0, -5.0],
    ];
    const r = buyerCohortAnalysis(features, 3, { seed: 11 });
    expect(r.assignment.nClusters).toBe(3);
    expect(r.silhouette).toBeGreaterThan(0.5);
  });
});
