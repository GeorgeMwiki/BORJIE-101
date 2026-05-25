/**
 * Cost-Quality Pareto runner tests — Phase D / D12.4.
 */

import { describe, it, expect } from 'vitest';
import {
  runCostPareto,
  type CostParetoVariant,
  type CostParetoScenario,
} from './runner.js';

// Synthetic golden corpus — small + deterministic.
const GOLDEN_SCENARIOS: ReadonlyArray<CostParetoScenario> = [
  { id: 'sce.1', description: 'rent reminder' },
  { id: 'sce.2', description: 'lease renewal' },
  { id: 'sce.3', description: 'eviction packet' },
  { id: 'sce.4', description: 'KRA MRI filing' },
  { id: 'sce.5', description: 'owner payout' },
];

// Variants that span the Pareto curve. Costs in $.
const HAIKU: CostParetoVariant = {
  id: 'claude-haiku-4-5',
  family: 'haiku',
  simulate: (id) => ({
    score: id === 'sce.3' ? 0.6 : 0.82,
    costUsd: 0.0008,
    latencyMs: 400,
  }),
};

const SONNET: CostParetoVariant = {
  id: 'claude-sonnet-4-5',
  family: 'sonnet',
  simulate: (id) => ({
    score: id === 'sce.3' ? 0.88 : 0.92,
    costUsd: 0.012,
    latencyMs: 700,
  }),
};

const OPUS: CostParetoVariant = {
  id: 'claude-opus-4-5',
  family: 'opus',
  simulate: (id) => ({
    score: id === 'sce.3' ? 0.95 : 0.97,
    costUsd: 0.045,
    latencyMs: 1200,
  }),
};

// Strictly-dominated variant — high cost AND low score.
const DOMINATED: CostParetoVariant = {
  id: 'expensive-poor',
  family: 'other',
  simulate: () => ({ score: 0.5, costUsd: 0.08, latencyMs: 1300 }),
};

describe('cost-quality Pareto runner', () => {
  it('runs the same corpus through every variant and reports mean score + cost', () => {
    const outcome = runCostPareto([HAIKU, SONNET, OPUS], GOLDEN_SCENARIOS);
    expect(outcome.summaries.length).toBe(3);
    for (const s of outcome.summaries) {
      expect(s.scenariosRun).toBe(GOLDEN_SCENARIOS.length);
      expect(s.meanScore).toBeGreaterThan(0);
      expect(s.meanCostUsd).toBeGreaterThan(0);
    }
  });

  it('all three Anthropic variants land on the Pareto frontier', () => {
    const outcome = runCostPareto([HAIKU, SONNET, OPUS], GOLDEN_SCENARIOS);
    expect(outcome.frontier.map((f) => f.variantId).sort()).toEqual(
      ['claude-haiku-4-5', 'claude-opus-4-5', 'claude-sonnet-4-5'].sort(),
    );
  });

  it('a strictly-dominated variant is excluded from the frontier', () => {
    const outcome = runCostPareto(
      [HAIKU, SONNET, OPUS, DOMINATED],
      GOLDEN_SCENARIOS,
    );
    const onFrontier = outcome.frontier.map((f) => f.variantId);
    expect(onFrontier).not.toContain('expensive-poor');
    expect(onFrontier.length).toBe(3);
  });

  it('totalCostUsd equals meanCostUsd * scenariosRun', () => {
    const outcome = runCostPareto([HAIKU, SONNET, OPUS], GOLDEN_SCENARIOS);
    for (const s of outcome.summaries) {
      const expected = s.meanCostUsd * s.scenariosRun;
      expect(Math.abs(s.totalCostUsd - expected)).toBeLessThan(1e-9);
    }
  });

  it('p95 latency reflects the variant simulator', () => {
    const outcome = runCostPareto([HAIKU, OPUS], GOLDEN_SCENARIOS);
    const haikuSummary = outcome.summaries.find(
      (s) => s.variantId === 'claude-haiku-4-5',
    );
    const opusSummary = outcome.summaries.find(
      (s) => s.variantId === 'claude-opus-4-5',
    );
    expect(haikuSummary?.p95LatencyMs).toBe(400);
    expect(opusSummary?.p95LatencyMs).toBe(1200);
  });

  it('an empty corpus yields zero-valued summaries', () => {
    const outcome = runCostPareto([HAIKU], []);
    expect(outcome.summaries[0]!.scenariosRun).toBe(0);
    expect(outcome.summaries[0]!.meanScore).toBe(0);
  });
});
