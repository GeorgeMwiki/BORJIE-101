/**
 * Seed library — 25 hypotheses across 5 areas.
 *
 * The Generation agent uses this as its prior pool. Each seed
 * is owned by exactly one STORM perspective so the rotation
 * stays balanced.
 *
 * Coverage check is enforced by the test suite:
 *   - 25 total
 *   - 5 per area
 *   - ≥ 1 per perspective (8 perspectives, 25 seeds → some
 *     perspectives own multiple)
 */

import type { HypothesisSeed } from '../types.js';
import { VACANCY_SEEDS } from './vacancy.js';
import { ARREARS_SEEDS } from './arrears.js';
import { MAINTENANCE_SEEDS } from './maintenance.js';
import { PRICING_SEEDS } from './pricing.js';
import { CHURN_SEEDS } from './churn.js';

export const SEED_LIBRARY: readonly HypothesisSeed[] = [
  ...VACANCY_SEEDS,
  ...ARREARS_SEEDS,
  ...MAINTENANCE_SEEDS,
  ...PRICING_SEEDS,
  ...CHURN_SEEDS,
];

export { VACANCY_SEEDS, ARREARS_SEEDS, MAINTENANCE_SEEDS, PRICING_SEEDS, CHURN_SEEDS };

/** Look up a single seed by id; undefined if not found. */
export function findSeedById(id: string): HypothesisSeed | undefined {
  return SEED_LIBRARY.find((s) => s.id === id);
}

/** Filter seeds by area. */
export function seedsByArea(area: HypothesisSeed['area']): readonly HypothesisSeed[] {
  return SEED_LIBRARY.filter((s) => s.area === area);
}

/** Filter seeds by owning perspective. */
export function seedsByPerspective(
  perspective: HypothesisSeed['owningPerspective'],
): readonly HypothesisSeed[] {
  return SEED_LIBRARY.filter((s) => s.owningPerspective === perspective);
}
