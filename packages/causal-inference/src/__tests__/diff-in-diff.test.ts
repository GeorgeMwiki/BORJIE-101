import { describe, expect, it } from 'vitest';
import {
  differencesInDifferences,
  inverseStandardNormalCdf,
  type DiDObservation,
} from '../estimate/diff-in-diff.js';
import { CausalInferenceError } from '../types.js';

/**
 * Cunningham's Mixtape (2021) Chapter 9 worked example:
 *
 *               Pre   Post
 *   Treated      10    16
 *   Control      10    12
 *
 *   ATE = (16 - 10) - (12 - 10) = 4.
 *
 * We replicate each cell with multiple observations so the OLS has
 * positive degrees of freedom.
 */
function mixtapeTextbookPanel(): ReadonlyArray<DiDObservation> {
  const obs: DiDObservation[] = [];
  for (let i = 0; i < 5; i += 1) {
    obs.push({ treated: true, post: true, outcome: 16 });
    obs.push({ treated: true, post: false, outcome: 10 });
    obs.push({ treated: false, post: true, outcome: 12 });
    obs.push({ treated: false, post: false, outcome: 10 });
  }
  return obs;
}

describe('Differences-in-Differences — textbook 2x2 panel', () => {
  it('returns ATE = 4 on Cunningham Mixtape Chapter 9', () => {
    const panel = mixtapeTextbookPanel();
    const r = differencesInDifferences(panel);
    expect(r.estimate).toBeCloseTo(4, 9);
    expect(r.identification).toBe('did');
    expect(r.sampleSize).toBe(panel.length);
  });

  it('produces a finite CI containing the point estimate', () => {
    // Add small noise so RSS > 0 and the SE is finite.
    const panel: DiDObservation[] = [];
    const tweaks = [-0.1, 0.05, 0.0, 0.07, -0.02];
    for (let i = 0; i < 5; i += 1) {
      const t = tweaks[i] as number;
      panel.push({ treated: true, post: true, outcome: 16 + t });
      panel.push({ treated: true, post: false, outcome: 10 - t });
      panel.push({ treated: false, post: true, outcome: 12 + t });
      panel.push({ treated: false, post: false, outcome: 10 - t });
    }
    const r = differencesInDifferences(panel);
    expect(r.ciLow).toBeLessThan(r.estimate);
    expect(r.ciHigh).toBeGreaterThan(r.estimate);
    expect(Number.isFinite(r.standardError ?? 0)).toBe(true);
  });

  it('throws on a panel missing one of the four cells', () => {
    const panel: ReadonlyArray<DiDObservation> = [
      { treated: true, post: true, outcome: 16 },
      { treated: true, post: false, outcome: 10 },
      { treated: false, post: true, outcome: 12 },
      // No control x pre cell.
    ];
    expect(() => differencesInDifferences(panel)).toThrow(
      CausalInferenceError,
    );
  });

  it('returns identification = "did" and labelled treatment/outcome', () => {
    const panel = mixtapeTextbookPanel();
    const r = differencesInDifferences(panel, {
      treatmentLabel: 'royalty_change',
      outcomeLabel: 'filing_latency',
    });
    expect(r.treatment).toBe('royalty_change');
    expect(r.outcome).toBe('filing_latency');
  });
});

describe('inverseStandardNormalCdf', () => {
  it('inverts the canonical 1.96 ≈ Φ^-1(0.975)', () => {
    expect(inverseStandardNormalCdf(0.975)).toBeCloseTo(1.96, 2);
  });

  it('is symmetric: Φ^-1(0.025) = -Φ^-1(0.975)', () => {
    const a = inverseStandardNormalCdf(0.025);
    const b = inverseStandardNormalCdf(0.975);
    expect(a).toBeCloseTo(-b, 6);
  });
});
