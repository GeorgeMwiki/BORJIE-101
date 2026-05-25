/**
 * pareto-frontier — non-dominated set across the four objectives.
 *
 * Useful when no single outcome wins on every dimension; the MD
 * surfaces the front and asks the owner to pick.
 */

import type { ScoredOutcome } from '../types.js';

function dominates(a: ScoredOutcome, b: ScoredOutcome): boolean {
  const ao = a.perObjective;
  const bo = b.perObjective;
  const allGte =
    ao.cashflow >= bo.cashflow &&
    ao.retention >= bo.retention &&
    ao.compliance >= bo.compliance &&
    ao.intentAlignment >= bo.intentAlignment;
  const someGt =
    ao.cashflow > bo.cashflow ||
    ao.retention > bo.retention ||
    ao.compliance > bo.compliance ||
    ao.intentAlignment > bo.intentAlignment;
  return allGte && someGt;
}

export function paretoFrontier(
  scored: ReadonlyArray<ScoredOutcome>,
): ReadonlyArray<ScoredOutcome> {
  return scored.filter((a) => !scored.some((b) => dominates(b, a)));
}
