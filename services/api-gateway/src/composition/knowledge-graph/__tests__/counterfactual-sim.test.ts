/**
 * Unit tests for counterfactual intervention simulation.
 *
 * Drives `simulateIntervention` over a SYNTHETIC, hand-built causal DAG
 * (conforming to the real `CausalDag` / `CausalEdge` / `CausalMetric`
 * contract from `causal-dag.ts`) so the suite is decoupled from the
 * sibling `buildCausalDag` series-reading implementation and exercises ONLY
 * the propagation maths + honest-degrade behaviour.
 *
 * Contract under test:
 *   1. A modelled intervention propagates the expected delta to the KPI
 *      along the dominant (highest-confidence) causal path
 *      (delta × ∏ strength × sign), with the right factual / counterfactual /
 *      deltaAbs / deltaPct, the realised propagation path, total lag, and
 *      assumptions on every number.
 *   2. Strengths compound multiplicatively across a multi-hop path; an
 *      inverse (sign = −1) edge flips the delta direction.
 *   3. The DOMINANT path is chosen when two paths reach the same target.
 *   4. An off-DAG intervened variable → explicit `variable-not-in-dag`
 *      (NEVER a fabricated number).
 *   5. An off-DAG target → `target-not-in-dag`.
 *   6. An unreachable target (no causal path) → `target-unreachable`.
 *   7. A below-floor path → `below-confidence-floor` (numbers null).
 *   8. A missing baseline for the variable → `missing-baseline`.
 *   9. An identity intervention (newValue == factual) → zero delta, ok.
 */

import { describe, it, expect } from 'vitest';
import {
  simulateIntervention,
  DEFAULT_CONFIDENCE_FLOOR,
} from '../counterfactual-sim.js';
import type { CausalDag, CausalEdge, CausalMetric } from '../causal-dag.js';

// ─────────────────────────────────────────────────────────────────────
// Synthetic DAG builder — mirrors the real CausalDag/CausalEdge shape.
// ─────────────────────────────────────────────────────────────────────

function edge(
  from: CausalMetric,
  to: CausalMetric,
  strength: number,
  lagDays: number,
  opts: { sign?: 1 | -1; confidence?: number; support?: number } = {},
): CausalEdge {
  return Object.freeze({
    from,
    to,
    strength,
    confidence: opts.confidence ?? strength,
    lagDays,
    sign: opts.sign ?? 1,
    support: opts.support ?? 12,
  });
}

function dagOf(
  edges: ReadonlyArray<CausalEdge>,
  metrics: ReadonlyArray<CausalMetric>,
): CausalDag {
  return Object.freeze({
    tenantId: 'tenant-test',
    nodes: Object.freeze(
      metrics.map((metric) => Object.freeze({ metric, hasData: true, points: 24 })),
    ),
    edges: Object.freeze([...edges]),
    dropped: Object.freeze([]),
    windowDays: 120,
    asOf: 1_700_000_000_000,
    series: Object.freeze([]),
  }) as CausalDag;
}

// The estate's real candidate chain:
//   production_tonnage --0.85,5d--> sales_receipts --0.95,30d--> cash_runway
const CHAIN_DAG = dagOf(
  [
    edge('production_tonnage', 'sales_receipts', 0.85, 5),
    edge('sales_receipts', 'cash_runway', 0.95, 30),
  ],
  ['production_tonnage', 'sales_receipts', 'cash_runway', 'royalty_filing_lateness'],
);

describe('simulateIntervention — propagation', () => {
  it('propagates the intervention delta to the KPI along the causal path', () => {
    // Baseline: sales_receipts 1000, cash_runway 500_000.
    const baseline = {
      sales_receipts: 1000,
      cash_runway: 500_000,
    };
    // Intervene: sales_receipts 1000 → 1150 (+150).
    const result = simulateIntervention(
      CHAIN_DAG,
      baseline,
      { variable: 'sales_receipts', newValue: 1150 },
      'cash_runway',
    );

    expect(result.status).toBe('ok');
    expect(result.factual).toBe(500_000);
    // delta = 150 × strength(0.95) × sign(+1) = 142.5 carried to cash_runway.
    expect(result.deltaAbs).toBeCloseTo(142.5, 6);
    expect(result.counterfactual).toBeCloseTo(500_142.5, 6);
    expect(result.deltaPct).toBeCloseTo((142.5 / 500_000) * 100, 9);
    // One hop on the path (sales → cash), lag 30d.
    expect(result.propagationPath).toHaveLength(1);
    expect(result.propagationPath[0]?.from).toBe('sales_receipts');
    expect(result.propagationPath[0]?.to).toBe('cash_runway');
    expect(result.propagationPath[0]?.inboundDelta).toBeCloseTo(150, 6);
    expect(result.propagationPath[0]?.outboundDelta).toBeCloseTo(142.5, 6);
    expect(result.totalLagDays).toBe(30);
    expect(result.confidence).toBeCloseTo(0.95, 6);
    // Every number carries assumptions.
    expect(result.assumptions.length).toBeGreaterThan(0);
    expect(result.assumptions.some((a) => a.includes('Linear local response'))).toBe(true);
    expect(result.intervention).toEqual({
      variable: 'sales_receipts',
      factualValue: 1000,
      newValue: 1150,
    });
  });

  it('compounds strengths multiplicatively across a multi-hop path', () => {
    // Intervene two hops upstream: production 200 → 400 (+200).
    const baseline = {
      production_tonnage: 200,
      sales_receipts: 1000,
      cash_runway: 500_000,
    };
    const result = simulateIntervention(
      CHAIN_DAG,
      baseline,
      { variable: 'production_tonnage', newValue: 400 },
      'cash_runway',
    );
    expect(result.status).toBe('ok');
    // delta = 200 × 0.85 × 0.95 = 161.5
    expect(result.deltaAbs).toBeCloseTo(200 * 0.85 * 0.95, 6);
    expect(result.propagationPath).toHaveLength(2);
    // confidence = 0.85 × 0.95
    expect(result.confidence).toBeCloseTo(0.85 * 0.95, 6);
    // total lag = 5 + 30
    expect(result.totalLagDays).toBe(35);
  });

  it('flips the delta direction across an inverse (sign = −1) edge', () => {
    // royalty_filing_lateness --0.7(−),10d--> cash_runway : MORE lateness
    // DRAINS runway, so a +delta in lateness yields a −delta in cash.
    const dag = dagOf(
      [edge('royalty_filing_lateness', 'cash_runway', 0.7, 10, { sign: -1 })],
      ['royalty_filing_lateness', 'cash_runway'],
    );
    const result = simulateIntervention(
      dag,
      { royalty_filing_lateness: 2, cash_runway: 90 },
      { variable: 'royalty_filing_lateness', newValue: 12 }, // +10 days late
      'cash_runway',
    );
    expect(result.status).toBe('ok');
    // delta = +10 × 0.7 × (−1) = −7 days of runway lost.
    expect(result.deltaAbs).toBeCloseTo(-7, 6);
    expect(result.counterfactual).toBeCloseTo(83, 6);
    expect(result.propagationPath[0]?.sign).toBe(-1);
  });

  it('picks the DOMINANT (highest-confidence) path when two reach the target', () => {
    // Two paths production → cash: a strong direct edge and a weak detour.
    const dag = dagOf(
      [
        edge('production_tonnage', 'cash_runway', 0.9, 1), // strong direct
        edge('production_tonnage', 'sales_receipts', 0.5, 2), // weak detour A
        edge('sales_receipts', 'cash_runway', 0.5, 3), // weak detour B (0.25)
      ],
      ['production_tonnage', 'sales_receipts', 'cash_runway'],
    );
    const result = simulateIntervention(
      dag,
      { production_tonnage: 100, cash_runway: 1000 },
      { variable: 'production_tonnage', newValue: 110 },
      'cash_runway',
    );
    expect(result.status).toBe('ok');
    // Dominant path is the direct edge (0.9 > 0.25), one hop.
    expect(result.propagationPath).toHaveLength(1);
    expect(result.confidence).toBeCloseTo(0.9, 6);
    expect(result.deltaAbs).toBeCloseTo(10 * 0.9, 6);
  });

  it('treats an identity intervention (newValue == factual) as zero delta, still ok', () => {
    const result = simulateIntervention(
      CHAIN_DAG,
      { sales_receipts: 1000, cash_runway: 500_000 },
      { variable: 'sales_receipts', newValue: 1000 },
      'cash_runway',
    );
    expect(result.status).toBe('ok');
    expect(result.deltaAbs).toBe(0);
    expect(result.counterfactual).toBe(500_000);
    expect(result.assumptions.some((a) => a.includes('zero delta'))).toBe(true);
  });

  it('reports deltaPct null when the target has no baseline (factual treated as 0)', () => {
    const result = simulateIntervention(
      CHAIN_DAG,
      { sales_receipts: 1000 }, // no cash_runway baseline
      { variable: 'sales_receipts', newValue: 1100 },
      'cash_runway',
    );
    expect(result.status).toBe('ok');
    expect(result.factual).toBe(0);
    expect(result.deltaPct).toBeNull();
    expect(result.counterfactual).toBeCloseTo(100 * 0.95, 6);
    expect(result.assumptions.some((a) => a.includes('treated as 0'))).toBe(true);
  });
});

describe('simulateIntervention — honest-degrade', () => {
  it('returns variable-not-in-dag for an off-DAG intervened variable (no fabrication)', () => {
    // A DAG that omits royalty_filing_lateness as a node entirely.
    const dag = dagOf(
      [edge('production_tonnage', 'cash_runway', 0.9, 1)],
      ['production_tonnage', 'cash_runway'],
    );
    const result = simulateIntervention(
      dag,
      { royalty_filing_lateness: 7 },
      { variable: 'royalty_filing_lateness', newValue: 9 },
      'cash_runway',
    );
    expect(result.status).toBe('variable-not-in-dag');
    expect(result.factual).toBeNull();
    expect(result.counterfactual).toBeNull();
    expect(result.deltaAbs).toBeNull();
    expect(result.deltaPct).toBeNull();
    expect(result.confidence).toBeNull();
    expect(result.reason).toContain('not a node in the causal DAG');
    expect(result.assumptions.some((a) => a.startsWith('Honest-degrade'))).toBe(true);
  });

  it('returns target-not-in-dag for an off-DAG target', () => {
    const dag = dagOf(
      [edge('production_tonnage', 'sales_receipts', 0.9, 1)],
      ['production_tonnage', 'sales_receipts'],
    );
    const result = simulateIntervention(
      dag,
      { production_tonnage: 1000 },
      { variable: 'production_tonnage', newValue: 1100 },
      'cash_runway', // absent from this DAG
    );
    expect(result.status).toBe('target-not-in-dag');
    expect(result.counterfactual).toBeNull();
    expect(result.reason).toContain('cash_runway');
  });

  it('returns target-unreachable when no causal path connects variable → target', () => {
    // Two disconnected edges: production→sales and royalty→cash.
    // Intervene production, target cash → no path.
    const dag = dagOf(
      [
        edge('production_tonnage', 'sales_receipts', 0.9, 1),
        edge('royalty_filing_lateness', 'cash_runway', 0.9, 1),
      ],
      ['production_tonnage', 'sales_receipts', 'royalty_filing_lateness', 'cash_runway'],
    );
    const result = simulateIntervention(
      dag,
      { production_tonnage: 10, cash_runway: 100 },
      { variable: 'production_tonnage', newValue: 20 },
      'cash_runway',
    );
    expect(result.status).toBe('target-unreachable');
    expect(result.counterfactual).toBeNull();
    expect(result.reason).toContain('No validated causal path');
  });

  it('returns below-confidence-floor when the dominant path is too weak', () => {
    // Path product 0.2 × 0.2 = 0.04, below the 0.3 default floor.
    const dag = dagOf(
      [
        edge('production_tonnage', 'sales_receipts', 0.2, 1),
        edge('sales_receipts', 'cash_runway', 0.2, 1),
      ],
      ['production_tonnage', 'sales_receipts', 'cash_runway'],
    );
    const result = simulateIntervention(
      dag,
      { production_tonnage: 10, cash_runway: 100 },
      { variable: 'production_tonnage', newValue: 20 },
      'cash_runway',
    );
    expect(result.status).toBe('below-confidence-floor');
    expect(result.counterfactual).toBeNull();
    expect(result.deltaAbs).toBeNull();
    expect(result.reason).toContain('below the floor');
    // The (rejected) path is still surfaced for transparency.
    expect(result.propagationPath.length).toBeGreaterThan(0);
  });

  it('honours a caller-supplied confidenceFloor override', () => {
    const dag = dagOf(
      [edge('production_tonnage', 'cash_runway', 0.5, 1)],
      ['production_tonnage', 'cash_runway'],
    );
    // 0.5 is above the default floor (0.3) but below an override of 0.6.
    const blocked = simulateIntervention(
      dag,
      { production_tonnage: 10, cash_runway: 100 },
      { variable: 'production_tonnage', newValue: 20 },
      'cash_runway',
      { confidenceFloor: 0.6 },
    );
    expect(blocked.status).toBe('below-confidence-floor');

    // Same path passes at the default floor.
    const ok = simulateIntervention(
      dag,
      { production_tonnage: 10, cash_runway: 100 },
      { variable: 'production_tonnage', newValue: 20 },
      'cash_runway',
      { confidenceFloor: DEFAULT_CONFIDENCE_FLOOR },
    );
    expect(ok.status).toBe('ok');
  });

  it('returns missing-baseline when the intervened variable has no factual value', () => {
    const result = simulateIntervention(
      CHAIN_DAG,
      { cash_runway: 500_000 }, // no sales_receipts baseline
      { variable: 'sales_receipts', newValue: 1100 },
      'cash_runway',
    );
    expect(result.status).toBe('missing-baseline');
    expect(result.intervention.factualValue).toBeNull();
    expect(result.reason).toContain('No baseline');
  });
});
