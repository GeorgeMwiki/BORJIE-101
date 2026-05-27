/**
 * Deterministic competence + activity-clock fixtures for control-shell
 * tests.
 *
 * Wave BLACKBOARD-CORE. The control shell depends on a
 * `CompetenceLookupPort` (production wraps capability-catalogue) and a
 * `KSActivityClockPort` (production caches last-post timestamps).
 * Tests use these simple in-memory maps so scoring is fully
 * deterministic.
 */

import type {
  CompetenceLookupPort,
  KSActivityClockPort,
} from '../control/control-shell.js';
import type { RegionKind } from '../types.js';

export interface InMemoryCompetenceMap {
  /** keyed by `${ksName}::${regionKind}` → score in [0, 1]. */
  readonly map: Record<string, number>;
}

export function createInMemoryCompetenceLookup(
  init: InMemoryCompetenceMap = { map: {} },
): CompetenceLookupPort {
  const store = new Map<string, number>();
  for (const [k, v] of Object.entries(init.map)) store.set(k, v);
  return {
    async scoreFor(_tenantId, ksName, regionKind) {
      const key = `${ksName}::${regionKind}`;
      return store.get(key) ?? null;
    },
  };
}

export interface InMemoryActivityClockMap {
  /** keyed by `${ksId}::${regionId}` → Δt in milliseconds since now. */
  readonly map: Record<string, number>;
}

export function createInMemoryActivityClock(
  init: InMemoryActivityClockMap = { map: {} },
): KSActivityClockPort {
  const store = new Map<string, number>();
  for (const [k, v] of Object.entries(init.map)) store.set(k, v);
  return {
    async lastSpokeAgoMs(_tenantId, ksId, regionId) {
      const key = `${ksId}::${regionId}`;
      return store.get(key) ?? null;
    },
  };
}

/** Tiny helper for tests that wire competence by region kind alone. */
export function competenceByRegion(
  byRegion: Partial<Record<RegionKind, Record<string, number>>>,
): InMemoryCompetenceMap {
  const map: Record<string, number> = {};
  for (const [regionKind, perKs] of Object.entries(byRegion)) {
    if (perKs === undefined) continue;
    for (const [ksName, score] of Object.entries(perKs)) {
      map[`${ksName}::${regionKind}`] = score;
    }
  }
  return { map };
}
