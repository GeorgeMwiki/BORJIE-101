/**
 * Unit tests for the causal DAG + root-cause engine.
 *
 * The engine is pure over a `CausalDbExecLike` seam AND over an injectable
 * `seriesOverride` / `series` test seam, so we drive it with a SMALL SYNTHETIC
 * DAG + time-series — no real DB. We assert the three load-bearing behaviours:
 *
 *   1. The RIGHT root cause is picked. A late royalty filing leads the cash dip
 *      with a strong lagged correlation; production co-moved only weakly. The
 *      engine must name royalty_filing_lateness, not production_tonnage.
 *   2. A red herring is RULED OUT. The weakly-correlated / barely-moved
 *      production node appears in `ruledOut`, never as the root cause.
 *   3. Thin data → { established: false }. Too few paired observations leaves
 *      the KPI with no validated upstream, so the engine refuses to guess.
 *
 * Honest-degrade and temporal precedence are the invariants under test — a
 * wrong root cause is worse than none.
 */

import { describe, expect, it } from 'vitest';
import {
  buildCausalDag,
  explainRootCause,
  pearson,
  MIN_EDGE_STRENGTH,
  ROOT_CAUSE_CONFIDENCE_FLOOR,
  type MetricPoint,
  type MetricSeries,
} from '../causal-dag.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 1); // fixed clock base

/** Build a daily series for a metric from an array of values (day i = T0+i). */
function dailySeries(
  metric: MetricSeries['metric'],
  values: ReadonlyArray<number>,
  evidencePrefix: string,
  dayStep = 1,
): MetricSeries {
  const points: MetricPoint[] = values.map((value, i) => ({
    t: T0 + i * dayStep * MS_PER_DAY,
    value,
    evidenceId: `${evidencePrefix}:${i}`,
  }));
  return { metric, points };
}

describe('pearson', () => {
  it('is +1 for a perfectly increasing pair and ~0 for a constant vector', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 6);
    expect(pearson([1, 2, 3, 4], [5, 5, 5, 5])).toBe(0);
  });
});

describe('buildCausalDag — validation + acyclicity', () => {
  it('promotes a strong, temporally-leading candidate and drops a thin one', async () => {
    // royalty_filing_lateness leads cash_runway: lateness spikes on day d, cash
    // runway falls on the SAME bucket (lag 0) in strong inverse lockstep.
    const lateness = dailySeries(
      'royalty_filing_lateness',
      [0, 0, 0, 10, 12, 14, 16, 18],
      'royalty_return',
    );
    const cash = dailySeries(
      'cash_runway',
      // strongly inverse to lateness on the same days
      [90, 90, 90, 60, 55, 50, 45, 40],
      'forecast',
    );
    // production has only TWO points → its candidate edges fail on paired data.
    const production = dailySeries('production_tonnage', [100, 101], 'tonnage_event');
    const sales = dailySeries('sales_receipts', [5, 5], 'sale');

    const dag = await buildCausalDag(undefined, 'tenant-x', {
      now: () => T0 + 8 * MS_PER_DAY,
      windowDays: 365,
      seriesOverride: [lateness, cash, production, sales],
    });

    // royalty_filing_lateness → cash_runway is validated and strong + inverse.
    const royaltyEdge = dag.edges.find(
      (e) => e.from === 'royalty_filing_lateness' && e.to === 'cash_runway',
    );
    expect(royaltyEdge).toBeDefined();
    expect(royaltyEdge?.strength).toBeGreaterThanOrEqual(MIN_EDGE_STRENGTH);
    expect(royaltyEdge?.sign).toBe(-1); // more lateness → less runway
    expect(royaltyEdge?.lagDays).toBeGreaterThanOrEqual(0); // temporal precedence

    // production-rooted candidates are dropped for thin paired data — never asserted.
    const prodToCash = dag.edges.find(
      (e) => e.from === 'production_tonnage' && e.to === 'cash_runway',
    );
    expect(prodToCash).toBeUndefined();
    expect(
      dag.dropped.some(
        (d) => d.from === 'production_tonnage' && d.reason !== 'cycle_break_weaker_edge',
      ),
    ).toBe(true);

    // DAG is acyclic: no metric reaches itself through the kept edges.
    const adjacency = new Map<string, string[]>();
    for (const e of dag.edges) {
      adjacency.set(e.from, [...(adjacency.get(e.from) ?? []), e.to]);
    }
    const reaches = (start: string, target: string): boolean => {
      const stack = [...(adjacency.get(start) ?? [])];
      const seen = new Set<string>();
      while (stack.length) {
        const n = stack.pop() as string;
        if (n === target) return true;
        if (seen.has(n)) continue;
        seen.add(n);
        stack.push(...(adjacency.get(n) ?? []));
      }
      return false;
    };
    for (const node of dag.nodes) {
      expect(reaches(node.metric, node.metric)).toBe(false);
    }
  });
});

describe('explainRootCause — names the cause, rules out the red herring', () => {
  it('picks the late royalty filing over the production red herring', async () => {
    // Cash dipped. Two upstream nodes co-moved in the window:
    //   - royalty_filing_lateness: a BIG spike, strongly inverse to cash → cause
    //   - production_tonnage: barely moved AND only weakly tied to cash → herring
    const lateness = dailySeries(
      'royalty_filing_lateness',
      [0, 0, 0, 0, 11, 13, 15, 17, 19, 21],
      'royalty_return',
    );
    const cash = dailySeries(
      'cash_runway',
      [95, 94, 95, 93, 62, 58, 54, 49, 45, 41],
      'forecast',
    );
    // Production DECLINES gently and tracks cash — so its causal route to cash
    // VALIDATES (the mechanism is real) — but production's own realized move is
    // tiny (~−6%). That is the red-herring trap: a real mechanism that barely
    // participated. Leverage = pathStrength × |move| must keep it well below the
    // royalty cause.
    const production = dailySeries(
      'production_tonnage',
      [100, 100, 99, 98, 96, 95, 94, 93, 92, 91],
      'tonnage_event',
    );
    // Sales mirror production's gentle decline (so production→sales→cash links).
    const sales = dailySeries(
      'sales_receipts',
      [50, 50, 49, 49, 48, 48, 47, 47, 46, 46],
      'sale',
    );

    const series = [lateness, cash, production, sales];
    const dag = await buildCausalDag(undefined, 'tenant-y', {
      now: () => T0 + 10 * MS_PER_DAY,
      windowDays: 365,
      seriesOverride: series,
    });

    const result = explainRootCause(dag, {
      metric: 'cash_runway',
      observedDeltaPct: -0.57,
      series,
    });

    expect(result.established).toBe(true);
    if (!result.established) return; // type-narrow for TS

    // The named cause is the late royalty filing.
    expect(result.rootCause.metric).toBe('royalty_filing_lateness');
    expect(result.rootCause.confidence).toBeGreaterThanOrEqual(
      ROOT_CAUSE_CONFIDENCE_FLOOR,
    );
    // Evidence rows are carried for the citation (evidence-required output).
    expect(result.rootCause.evidenceIds.length).toBeGreaterThan(0);
    expect(result.rootCause.evidenceIds[0]).toMatch(/^royalty_return:/);

    // Production is ruled out as a red herring — present in ruledOut, NOT the cause.
    expect(result.rootCause.metric).not.toBe('production_tonnage');
    const ruledOutMetrics = result.ruledOut.map((r) => r.metric);
    expect(ruledOutMetrics).toContain('production_tonnage');

    // The cause out-leverages every red herring.
    for (const herring of result.ruledOut) {
      expect(result.rootCause.leverage).toBeGreaterThanOrEqual(herring.leverage);
    }
  });
});

describe('explainRootCause — honest-degrade on thin data', () => {
  it('returns { established: false } when no upstream validates', async () => {
    // Only 2 paired observations everywhere → no candidate edge can validate,
    // so cash_runway has no validated ancestor. The engine must refuse to guess.
    const lateness = dailySeries('royalty_filing_lateness', [0, 10], 'royalty_return');
    const cash = dailySeries('cash_runway', [90, 50], 'forecast');
    const production = dailySeries('production_tonnage', [100, 90], 'tonnage_event');
    const sales = dailySeries('sales_receipts', [5, 4], 'sale');

    const series = [lateness, cash, production, sales];
    const dag = await buildCausalDag(undefined, 'tenant-z', {
      now: () => T0 + 2 * MS_PER_DAY,
      windowDays: 365,
      seriesOverride: series,
    });

    // No validated edges from such thin data.
    expect(dag.edges).toHaveLength(0);

    const result = explainRootCause(dag, {
      metric: 'cash_runway',
      observedDeltaPct: -0.44,
      series,
    });

    expect(result.established).toBe(false);
    if (result.established) return;
    expect(result.reason).toMatch(/cannot establish a cause/i);
    expect(result.ranked).toHaveLength(0);
  });

  it('returns { established: false } when the KPI metric is unknown to the DAG', async () => {
    const dag = await buildCausalDag(undefined, 'tenant-empty', {
      now: () => T0,
      seriesOverride: [],
    });
    const result = explainRootCause(dag, {
      metric: 'cash_runway',
      observedDeltaPct: -0.2,
      series: [],
    });
    expect(result.established).toBe(false);
  });
});

describe('buildCausalDag — degrades cleanly with no db and no override', () => {
  it('returns data-less nodes and zero edges (never throws, never guesses)', async () => {
    const dag = await buildCausalDag(null, 'tenant-nodb', { now: () => T0 });
    expect(dag.edges).toHaveLength(0);
    expect(dag.nodes.every((n) => n.hasData === false)).toBe(true);
    // Every candidate is dropped for 'no_series'.
    expect(dag.dropped.every((d) => d.reason === 'no_series')).toBe(true);
  });
});
