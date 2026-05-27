/**
 * Deterministic competence lookup fixture — BLACKBOARD-CORE tests.
 *
 * Returns hard-coded scores per (ksName, regionKind). Production
 * wires the capability-catalogue's measurement aggregator (Wave
 * CAPABILITY) which reads from `capability_measurement_outcomes`.
 *
 * Spec: Docs/DESIGN/BLACKBOARD_SOTA_2026.md §3.2, §5.
 */

import type { CompetenceLookupPort, KSActivityClockPort } from '../control/control-shell.js';
import type { RegionKind } from '../types.js';

export interface FixtureCompetenceEntry {
  readonly ksName: string;
  readonly regionKind: RegionKind;
  readonly score: number;
}

/** Build a fixture competence lookup port from a list of entries. */
export function createFixtureCompetenceLookupPort(
  entries: ReadonlyArray<FixtureCompetenceEntry>,
): CompetenceLookupPort {
  const table = new Map<string, number>();
  for (const e of entries) {
    table.set(`${e.ksName}::${e.regionKind}`, e.score);
  }
  return {
    async scoreFor(_tenantId, ksName, regionKind) {
      const v = table.get(`${ksName}::${regionKind}`);
      return v ?? null;
    },
  };
}

/** Build a fixture KS-activity clock port from a map of ksId -> Δt ms. */
export function createFixtureActivityClockPort(
  table: Readonly<Record<string, number | null>>,
): KSActivityClockPort {
  return {
    async lastSpokeAgoMs(_tenantId, ksId, _regionId) {
      const v = table[ksId];
      return v === undefined ? null : v;
    },
  };
}
