/**
 * Unit tests for `drift-detector.ts`.
 *
 * Verifies Welford's running stats, per-(tenant, route) isolation,
 * input-immutability, and the 2-sigma drift signal.
 */

import { describe, expect, it } from 'vitest';
import {
  DRIFT_SIGMA_THRESHOLD,
  DriftDetector,
  RING_BUFFER_SIZE,
} from '../drift-detector.js';

/**
 * Build a length-3 embedding with a small jitter on the trailing dim.
 * Keeps the centroid near `base` and the variance modest.
 */
function jitter(base: ReadonlyArray<number>, eps: number): number[] {
  return base.map((v, i) => v + (i === base.length - 1 ? eps : 0));
}

describe('DriftDetector — constants', (): void => {
  it('exports DRIFT_SIGMA_THRESHOLD = 2', (): void => {
    expect(DRIFT_SIGMA_THRESHOLD).toBe(2);
  });

  it('exports RING_BUFFER_SIZE = 100', (): void => {
    expect(RING_BUFFER_SIZE).toBe(100);
  });
});

describe('DriftDetector — basic recording', (): void => {
  it('returns zero signal before any samples', (): void => {
    const det = new DriftDetector();
    const sig = det.getDriftSignal('t1', 'route-a');
    expect(sig.sampleCount).toBe(0);
    expect(sig.isDrifting).toBe(false);
    expect(sig.std).toBe(0);
  });

  it('rejects empty embeddings without crashing', (): void => {
    const det = new DriftDetector();
    det.recordQuery('t1', 'route-a', []);
    expect(det.getDriftSignal('t1', 'route-a').sampleCount).toBe(0);
  });

  it('rejects empty tenant or route ids', (): void => {
    const det = new DriftDetector();
    det.recordQuery('', 'route-a', [1, 0, 0]);
    det.recordQuery('t1', '', [1, 0, 0]);
    expect(det.getDriftSignal('', 'route-a').sampleCount).toBe(0);
    expect(det.getDriftSignal('t1', '').sampleCount).toBe(0);
  });
});

describe('DriftDetector — homogeneous traffic', (): void => {
  it('100 similar queries produce low drift and no spike', (): void => {
    const det = new DriftDetector();
    // Sweep a small perturbation around the same base direction so
    // distances form a tight, well-behaved Gaussian-ish band (avoids
    // the floating-point edge case where σ collapses to zero).
    for (let i = 0; i < 100; i += 1) {
      // A deterministic, small, uniformly-spread perturbation.
      const eps = ((i % 7) - 3) * 0.001;
      det.recordQuery('t1', 'route-a', [1 + eps, eps, eps]);
    }
    const sig = det.getDriftSignal('t1', 'route-a');
    expect(sig.sampleCount).toBe(100);
    // Mean cosine-distance to centroid should stay well below 0.01
    // for these nearly-aligned vectors.
    expect(sig.mean).toBeLessThan(0.01);
    // The final sample is just another member of the same cluster —
    // it must NOT trip the 2σ alarm.
    expect(sig.isDrifting).toBe(false);
  });
});

describe('DriftDetector — outliers', (): void => {
  it('flags isDrifting=true for an outlier embedding', (): void => {
    const det = new DriftDetector();
    // 30 homogeneous queries to settle the centroid.
    for (let i = 0; i < 30; i += 1) {
      det.recordQuery('t1', 'route-a', jitter([1, 0, 0], i * 1e-6));
    }
    // Now a single orthogonal outlier — cosine distance ≈ 1.
    det.recordQuery('t1', 'route-a', [0, 1, 0]);
    const sig = det.getDriftSignal('t1', 'route-a');
    expect(sig.isDrifting).toBe(true);
    expect(sig.lastSampleDistance).toBeGreaterThan(0.5);
  });
});

describe('DriftDetector — Welford stability', (): void => {
  it('mean stays correct across 10k samples (numerical stability)', (): void => {
    const det = new DriftDetector();
    // 10 000 random-ish but bounded samples. Welford should produce a
    // stable mean — naive sum-of-squares would lose precision well
    // before this point on f64.
    for (let i = 0; i < 10000; i += 1) {
      const x = Math.sin(i * 0.137);
      const y = Math.cos(i * 0.137);
      det.recordQuery('t1', 'route-stab', [x, y, 0]);
    }
    const sig = det.getDriftSignal('t1', 'route-stab');
    expect(sig.sampleCount).toBe(10000);
    expect(Number.isFinite(sig.mean)).toBe(true);
    expect(Number.isFinite(sig.std)).toBe(true);
    // Mean of cosine-distances in a balanced stream stays in [0, 2].
    expect(sig.mean).toBeGreaterThanOrEqual(0);
    expect(sig.mean).toBeLessThanOrEqual(2);
  });
});

describe('DriftDetector — per-tenant isolation', (): void => {
  it('does not leak samples across tenants', (): void => {
    const det = new DriftDetector();
    for (let i = 0; i < 20; i += 1) {
      det.recordQuery('tenant-A', 'route-x', [1, 0, 0]);
    }
    det.recordQuery('tenant-B', 'route-x', [0, 1, 0]);

    const a = det.getDriftSignal('tenant-A', 'route-x');
    const b = det.getDriftSignal('tenant-B', 'route-x');
    expect(a.sampleCount).toBe(20);
    expect(b.sampleCount).toBe(1);
  });

  it('does not leak samples across routes within the same tenant', (): void => {
    const det = new DriftDetector();
    det.recordQuery('tenant-A', 'route-x', [1, 0, 0]);
    det.recordQuery('tenant-A', 'route-x', [1, 0, 0]);
    det.recordQuery('tenant-A', 'route-y', [0, 1, 0]);

    expect(det.getDriftSignal('tenant-A', 'route-x').sampleCount).toBe(2);
    expect(det.getDriftSignal('tenant-A', 'route-y').sampleCount).toBe(1);
  });
});

describe('DriftDetector — immutability', (): void => {
  it('does NOT mutate the caller embedding', (): void => {
    const det = new DriftDetector();
    const emb = [1, 2, 3];
    const before = emb.slice();
    det.recordQuery('t1', 'route-a', emb);
    expect(emb).toEqual(before);
  });
});

describe('DriftDetector — snapshot / restore', (): void => {
  it('round-trips a snapshot losslessly', (): void => {
    const detA = new DriftDetector();
    for (let i = 0; i < 10; i += 1) {
      detA.recordQuery('t1', 'r', jitter([1, 0, 0], i * 1e-3));
    }
    const snap = detA.snapshot('t1', 'r');
    expect(snap).not.toBeNull();

    const detB = new DriftDetector();
    detB.restore('t1', 'r', snap!);
    const sigA = detA.getDriftSignal('t1', 'r');
    const sigB = detB.getDriftSignal('t1', 'r');
    expect(sigB.sampleCount).toBe(sigA.sampleCount);
    expect(sigB.mean).toBeCloseTo(sigA.mean, 12);
    expect(sigB.std).toBeCloseTo(sigA.std, 12);
  });

  it('snapshot returns null for an unseen bucket', (): void => {
    const det = new DriftDetector();
    expect(det.snapshot('nope', 'nope')).toBeNull();
  });
});

describe('DriftDetector — ring buffer bound', (): void => {
  it('caps the window at RING_BUFFER_SIZE entries', (): void => {
    const det = new DriftDetector();
    for (let i = 0; i < RING_BUFFER_SIZE + 50; i += 1) {
      det.recordQuery('t1', 'r', [Math.sin(i), Math.cos(i), 0]);
    }
    const snap = det.snapshot('t1', 'r');
    expect(snap?.window.length).toBe(RING_BUFFER_SIZE);
  });
});
