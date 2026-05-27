import { describe, expect, it } from 'vitest';
import {
  fuelPriceImpact,
  royaltyRateImpact,
  shiftScheduleImpact,
  supervisorAssignmentImpact,
} from '../domain/mining-causal.js';
import { mulberry32 } from '../refute/prng.js';
import { type CausalGraph } from '../types.js';

describe('Mr. Mwikila mining-domain wrappers — shape and identification', () => {
  it('shiftScheduleImpact returns a DiD summary with identification = did', () => {
    const panel = [
      { treated: true, post: true, outcome: 6 },
      { treated: true, post: false, outcome: 3 },
      { treated: false, post: true, outcome: 5 },
      { treated: false, post: false, outcome: 4 },
      { treated: true, post: true, outcome: 7 },
      { treated: true, post: false, outcome: 3 },
      { treated: false, post: true, outcome: 5 },
      { treated: false, post: false, outcome: 4 },
    ];
    const r = shiftScheduleImpact({ panel });
    expect(r.identification).toBe('did');
    expect(r.treatment).toBe('compressed_shift');
    expect(r.outcome).toBe('incident_rate');
    // T_post mean = (6+7)/2 = 6.5, T_pre = 3, C_post = 5, C_pre = 4.
    // ATE = (6.5 - 3) - (5 - 4) = 2.5.
    expect(r.effect.estimate).toBeCloseTo(2.5, 6);
  });

  it('royaltyRateImpact returns a synthetic-control summary', () => {
    const r = royaltyRateImpact({
      panel: {
        treatedPre: [10, 10, 10, 10],
        donorPre: [
          [10, 10, 10, 10],
          [10, 10, 10, 10],
        ],
        treatedPost: [13, 13, 13],
        donorPost: [
          [10, 10, 10],
          [10, 10, 10],
        ],
      },
    });
    expect(r.identification).toBe('synthetic-control');
    expect(r.treatment).toBe('new_royalty_schedule');
    expect(r.outcome).toBe('filing_latency_days');
    expect(r.effect.estimate).toBeCloseTo(3, 0);
  });

  it('fuelPriceImpact returns a Granger summary with the Granger result attached', () => {
    const rng = mulberry32(123);
    const n = 200;
    const fuel: number[] = new Array(n).fill(0);
    const prod: number[] = new Array(n).fill(0);
    for (let t = 1; t < n; t += 1) {
      fuel[t] = 0.3 * (fuel[t - 1] as number) + (rng() - 0.5);
      prod[t] =
        0.6 * (fuel[t - 1] as number) +
        0.2 * (prod[t - 1] as number) +
        (rng() - 0.5);
    }
    const r = fuelPriceImpact({
      fuelPriceSeries: fuel,
      productionSeries: prod,
      maxLag: 1,
    });
    expect(r.identification).toBe('granger');
    expect(r.granger.causal).toBe(true);
    expect(r.granger.pValue).toBeLessThan(0.05);
  });

  it('supervisorAssignmentImpact uses the back-door adjustment set', () => {
    // DAG: pit -> supervisor (selection), pit -> throughput, supervisor -> throughput.
    // Back-door set for supervisor -> throughput must be {pit}.
    const graph: CausalGraph = {
      nodes: ['pit', 'supervisor', 'throughput'],
      edges: [
        { from: 'pit', to: 'supervisor' },
        { from: 'pit', to: 'throughput' },
        { from: 'supervisor', to: 'throughput' },
      ],
    };
    // Synthetic data: within each pit, supervisor uplifts throughput by 5.
    const supervisor: number[] = [];
    const pit: number[] = [];
    const throughput: number[] = [];
    for (let p = 0; p < 2; p += 1) {
      for (let s = 0; s < 2; s += 1) {
        for (let i = 0; i < 10; i += 1) {
          pit.push(p);
          supervisor.push(s);
          throughput.push(p * 3 + s * 5);
        }
      }
    }
    const r = supervisorAssignmentImpact({
      graph,
      treatment: 'supervisor',
      outcome: 'throughput',
      data: { pit, supervisor, throughput },
    });
    expect(r.identification).toBe('backdoor');
    expect(r.effect.estimate).toBeCloseTo(5, 0);
  });
});
