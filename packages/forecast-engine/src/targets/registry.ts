/**
 * Forecast-target registry — the single lookup binding every target id
 * to its definition. Build-time exhaustiveness keeps the catalogue
 * coherent; a duplicate id throws at construction.
 */

import type { ForecastTargetDef, Domain } from './types.js';
import { MINING_TARGETS } from './mining-targets.js';
import { REAL_ESTATE_TARGETS } from './real-estate-targets.js';

const ALL: ReadonlyArray<ForecastTargetDef> = [
  ...MINING_TARGETS,
  ...REAL_ESTATE_TARGETS,
];

const BY_ID: ReadonlyMap<string, ForecastTargetDef> = (() => {
  const map = new Map<string, ForecastTargetDef>();
  for (const t of ALL) {
    if (map.has(t.id)) {
      throw new Error(`duplicate forecast target id: ${t.id}`);
    }
    map.set(t.id, t);
  }
  return map;
})();

export const FORECAST_TARGETS: ReadonlyArray<ForecastTargetDef> = ALL;

/** Look up a target definition by id. */
export function getTarget(id: string): ForecastTargetDef | undefined {
  return BY_ID.get(id);
}

/** All targets in a domain. */
export function targetsForDomain(domain: Domain): ReadonlyArray<ForecastTargetDef> {
  return ALL.filter((t) => t.domain === domain);
}

/** All HIGH-risk (fail-closed, human-gated) targets. */
export function highRiskTargets(): ReadonlyArray<ForecastTargetDef> {
  return ALL.filter((t) => t.highRisk);
}
