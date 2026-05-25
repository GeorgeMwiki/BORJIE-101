/**
 * Cost-Quality Pareto runner — Phase D / D12.4.
 *
 * Runs the SAME golden corpus through Haiku / Sonnet / Opus (or any
 * declared list of model variants) AND records:
 *   - average judge score (the "quality" axis), and
 *   - average cost per scenario (the "cost" axis), and
 *   - p95 latency.
 *
 * Then computes the Pareto frontier — the set of variants that no
 * other variant dominates on BOTH axes. The frontier is what an
 * operator can pick from rationally; anything off the frontier is
 * strictly worse than at least one on it.
 *
 * Pure deterministic harness — each variant carries a `simulate`
 * function returning `{score, costUsd, latencyMs}` per scenario. The
 * test suite passes stub variants so CI never spends real $.
 */

export interface CostParetoVariant {
  /** Stable variant id, e.g. 'claude-haiku-4-5' or 'gpt-4o-mini'. */
  readonly id: string;
  /** Family label so the chart can colour-group. */
  readonly family: 'haiku' | 'sonnet' | 'opus' | 'other';
  /**
   * Deterministic simulator that maps a scenario id → outcome triple.
   * Real runs would call the live model + judge here; tests pass a
   * fixed-table simulator.
   */
  readonly simulate: (scenarioId: string) => CostParetoOutcomePoint;
}

export interface CostParetoOutcomePoint {
  /** Judge score in [0, 1]. */
  readonly score: number;
  /** Marginal cost in USD for the scenario. */
  readonly costUsd: number;
  /** End-to-end latency in milliseconds. */
  readonly latencyMs: number;
}

export interface CostParetoScenario {
  readonly id: string;
  readonly description: string;
}

export interface CostParetoVariantSummary {
  readonly variantId: string;
  readonly family: CostParetoVariant['family'];
  readonly scenariosRun: number;
  readonly meanScore: number;
  readonly meanCostUsd: number;
  readonly p95LatencyMs: number;
  readonly totalCostUsd: number;
  /** TRUE iff no other variant dominates this one on BOTH score and cost. */
  readonly onParetoFrontier: boolean;
}

export interface CostParetoOutcome {
  readonly summaries: ReadonlyArray<CostParetoVariantSummary>;
  /** Convenience subset — every entry has `onParetoFrontier === true`. */
  readonly frontier: ReadonlyArray<CostParetoVariantSummary>;
}

// ─────────────────────────────────────────────────────────────────────
// Aggregation helpers
// ─────────────────────────────────────────────────────────────────────

function p95(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length));
  return sorted[idx]!;
}

/**
 * A variant A dominates variant B when A has HIGHER score AND LOWER cost
 * (ties allowed in only one axis). The Pareto frontier is the set of
 * variants no other variant strictly dominates.
 */
function dominates(a: CostParetoVariantSummary, b: CostParetoVariantSummary): boolean {
  const scoreBetterOrEqual = a.meanScore >= b.meanScore;
  const costBetterOrEqual = a.meanCostUsd <= b.meanCostUsd;
  const strictlyBetter =
    a.meanScore > b.meanScore || a.meanCostUsd < b.meanCostUsd;
  return scoreBetterOrEqual && costBetterOrEqual && strictlyBetter;
}

// ─────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────

export function runCostPareto(
  variants: ReadonlyArray<CostParetoVariant>,
  scenarios: ReadonlyArray<CostParetoScenario>,
): CostParetoOutcome {
  const raw: CostParetoVariantSummary[] = variants.map((v) => {
    const points = scenarios.map((s) => v.simulate(s.id));
    const meanScore =
      points.length === 0
        ? 0
        : points.reduce((acc, p) => acc + p.score, 0) / points.length;
    const totalCostUsd = points.reduce((acc, p) => acc + p.costUsd, 0);
    const meanCostUsd =
      points.length === 0 ? 0 : totalCostUsd / points.length;
    const p95LatencyMs = p95(points.map((p) => p.latencyMs));
    return {
      variantId: v.id,
      family: v.family,
      scenariosRun: points.length,
      meanScore,
      meanCostUsd,
      p95LatencyMs,
      totalCostUsd,
      onParetoFrontier: true, // overwritten below
    };
  });

  // Pareto pass — mark dominated variants.
  const summaries: CostParetoVariantSummary[] = raw.map((s) => {
    const dominated = raw.some((other) => other !== s && dominates(other, s));
    return { ...s, onParetoFrontier: !dominated };
  });

  const frontier = summaries.filter((s) => s.onParetoFrontier);
  return { summaries, frontier };
}
