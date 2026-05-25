/**
 * diff-view-renderer — turn ranked outcomes into a DiffView UiPart.
 *
 * The UiPart spec is intentionally minimal here so this package does
 * not import the genui package. The downstream renderer can adapt
 * it. Trade-offs are surfaced as bullet strings.
 */

import type { DiffView, ScoredOutcome } from '../types.js';

export function renderDiffView(
  ranked: ReadonlyArray<ScoredOutcome>,
): DiffView {
  const winner = ranked[0];
  const recommended = winner?.scenarioName ?? '(no scenarios)';
  const alternatives = ranked.slice(0, 3).map((s) => ({
    name: s.scenarioName,
    score: s.score,
    summary: `cash=${s.perObjective.cashflow.toFixed(2)} ret=${s.perObjective.retention.toFixed(2)} comp=${s.perObjective.compliance.toFixed(2)} intent=${s.perObjective.intentAlignment.toFixed(2)}`,
  }));

  const tradeOffs = computeTradeOffs(ranked);
  return {
    kind: 'forecasting.DiffView.v1',
    recommended,
    alternatives,
    tradeOffs,
  };
}

function computeTradeOffs(scored: ReadonlyArray<ScoredOutcome>): string[] {
  const out: string[] = [];
  if (scored.length < 2) return out;
  const [a, b] = scored;
  if (a === undefined || b === undefined) return out;
  if (a.perObjective.cashflow > b.perObjective.cashflow && a.perObjective.retention < b.perObjective.retention) {
    out.push(`${a.scenarioName} wins on cashflow but loses on retention vs ${b.scenarioName}`);
  }
  if (a.perObjective.compliance < b.perObjective.compliance) {
    out.push(`${a.scenarioName} has lower compliance score than ${b.scenarioName}`);
  }
  if (a.cashShortfallProbability > 0.3) {
    out.push(`${a.scenarioName} carries cash-shortfall risk p=${a.cashShortfallProbability.toFixed(2)}`);
  }
  return out;
}
