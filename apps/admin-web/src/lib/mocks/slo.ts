import type { SloMetric } from './types';

function spark(seed: number, len = 24): ReadonlyArray<number> {
  const out: number[] = [];
  let v = seed;
  for (let i = 0; i < len; i += 1) {
    v = (v * 9301 + 49297) % 233280;
    out.push(0.3 + (v / 233280) * 0.7);
  }
  return out;
}

export const MOCK_SLO: ReadonlyArray<SloMetric> = [
  {
    juniorId: 'jr_master',
    junior: 'Master Brain',
    p50ms: 820,
    p95ms: 1420,
    p99ms: 2180,
    errorRatePct: 0.2,
    spendUsd: 482.1,
    requestVolume24h: 14_220,
    sparkline: spark(11),
  },
  {
    juniorId: 'jr_geology',
    junior: 'Geology',
    p50ms: 910,
    p95ms: 1620,
    p99ms: 2880,
    errorRatePct: 0.4,
    spendUsd: 244.55,
    requestVolume24h: 3_420,
    sparkline: spark(37),
  },
  {
    juniorId: 'jr_compliance',
    junior: 'Compliance',
    p50ms: 1740,
    p95ms: 2840,
    p99ms: 4220,
    errorRatePct: 1.8,
    spendUsd: 612.8,
    requestVolume24h: 1_880,
    sparkline: spark(83),
  },
  {
    juniorId: 'jr_cost',
    junior: 'Cost Engineer',
    p50ms: 580,
    p95ms: 980,
    p99ms: 1320,
    errorRatePct: 0.1,
    spendUsd: 312.5,
    requestVolume24h: 2_410,
    sparkline: spark(53),
  },
  {
    juniorId: 'jr_sales',
    junior: 'Sales',
    p50ms: 280,
    p95ms: 410,
    p99ms: 720,
    errorRatePct: 0.0,
    spendUsd: 98.4,
    requestVolume24h: 820,
    sparkline: spark(101),
  },
  {
    juniorId: 'jr_fx',
    junior: 'FX / Treasury',
    p50ms: 320,
    p95ms: 510,
    p99ms: 880,
    errorRatePct: 0.1,
    spendUsd: 64.8,
    requestVolume24h: 1_120,
    sparkline: spark(7),
  },
];
