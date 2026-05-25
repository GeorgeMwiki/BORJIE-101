/**
 * A/B prompt comparison runner — Phase D / D12.5.
 *
 * Takes two prompt variants (A and B) and a corpus; returns the
 * winner on each axis:
 *   - completion rate (proportion of scenarios that completed cleanly)
 *   - mean cost
 *   - mean judge score
 *   - mean latency
 *
 * The runner is pure — each variant carries a deterministic simulator
 * that returns the per-scenario triple `{score, costUsd, latencyMs,
 * completed}`. Real callers wire live LLM + judge here; tests pass
 * stub simulators so CI is hermetic.
 */

export type AbAxis = 'completion-rate' | 'cost' | 'score' | 'latency';
export type AbWinner = 'A' | 'B' | 'tie';

export interface AbVariantOutcomePoint {
  readonly score: number; // 0..1
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly completed: boolean;
}

export interface AbPromptVariant {
  /** Stable id, e.g. 'baseline-v1' or 'rewrite-2026-05-17'. */
  readonly id: string;
  /** Human-readable label (≤ 60 chars). */
  readonly label: string;
  /** Deterministic per-scenario simulator. */
  readonly simulate: (scenarioId: string) => AbVariantOutcomePoint;
}

export interface AbScenario {
  readonly id: string;
  readonly description: string;
}

export interface AbVariantSummary {
  readonly variantId: string;
  readonly completionRate: number;
  readonly meanScore: number;
  readonly meanCostUsd: number;
  readonly meanLatencyMs: number;
}

export interface AbAxisVerdict {
  readonly axis: AbAxis;
  readonly winner: AbWinner;
  readonly delta: number;
}

export interface AbOutcome {
  readonly a: AbVariantSummary;
  readonly b: AbVariantSummary;
  readonly verdicts: ReadonlyArray<AbAxisVerdict>;
  /** Overall summary string, e.g. "B wins on cost+score; A wins on latency". */
  readonly headline: string;
}

// ─────────────────────────────────────────────────────────────────────
// Per-axis winner helpers
// ─────────────────────────────────────────────────────────────────────

/** For axes where higher = better (completion-rate, score). */
function higherWins(aVal: number, bVal: number): AbWinner {
  if (Math.abs(aVal - bVal) < 1e-9) return 'tie';
  return aVal > bVal ? 'A' : 'B';
}

/** For axes where lower = better (cost, latency). */
function lowerWins(aVal: number, bVal: number): AbWinner {
  if (Math.abs(aVal - bVal) < 1e-9) return 'tie';
  return aVal < bVal ? 'A' : 'B';
}

function buildSummary(
  variant: AbPromptVariant,
  scenarios: ReadonlyArray<AbScenario>,
): AbVariantSummary {
  const points = scenarios.map((s) => variant.simulate(s.id));
  if (points.length === 0) {
    return {
      variantId: variant.id,
      completionRate: 0,
      meanScore: 0,
      meanCostUsd: 0,
      meanLatencyMs: 0,
    };
  }
  const completionRate =
    points.filter((p) => p.completed).length / points.length;
  const meanScore =
    points.reduce((acc, p) => acc + p.score, 0) / points.length;
  const meanCostUsd =
    points.reduce((acc, p) => acc + p.costUsd, 0) / points.length;
  const meanLatencyMs =
    points.reduce((acc, p) => acc + p.latencyMs, 0) / points.length;
  return {
    variantId: variant.id,
    completionRate,
    meanScore,
    meanCostUsd,
    meanLatencyMs,
  };
}

export function runAbPrompt(
  a: AbPromptVariant,
  b: AbPromptVariant,
  scenarios: ReadonlyArray<AbScenario>,
): AbOutcome {
  const aSummary = buildSummary(a, scenarios);
  const bSummary = buildSummary(b, scenarios);

  const verdicts: AbAxisVerdict[] = [
    {
      axis: 'completion-rate',
      winner: higherWins(aSummary.completionRate, bSummary.completionRate),
      delta: aSummary.completionRate - bSummary.completionRate,
    },
    {
      axis: 'score',
      winner: higherWins(aSummary.meanScore, bSummary.meanScore),
      delta: aSummary.meanScore - bSummary.meanScore,
    },
    {
      axis: 'cost',
      winner: lowerWins(aSummary.meanCostUsd, bSummary.meanCostUsd),
      delta: aSummary.meanCostUsd - bSummary.meanCostUsd,
    },
    {
      axis: 'latency',
      winner: lowerWins(aSummary.meanLatencyMs, bSummary.meanLatencyMs),
      delta: aSummary.meanLatencyMs - bSummary.meanLatencyMs,
    },
  ];

  const aWins = verdicts.filter((v) => v.winner === 'A').map((v) => v.axis);
  const bWins = verdicts.filter((v) => v.winner === 'B').map((v) => v.axis);
  const ties = verdicts.filter((v) => v.winner === 'tie').map((v) => v.axis);

  const segments: string[] = [];
  if (aWins.length > 0)
    segments.push(`${a.label} wins on ${aWins.join('+')}`);
  if (bWins.length > 0)
    segments.push(`${b.label} wins on ${bWins.join('+')}`);
  if (ties.length > 0) segments.push(`tied on ${ties.join('+')}`);
  const headline = segments.length === 0 ? 'no contest' : segments.join('; ');

  return { a: aSummary, b: bSummary, verdicts, headline };
}
