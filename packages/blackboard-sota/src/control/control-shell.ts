/**
 * Control shell — the metalevel scheduler from Hayes-Roth 1985.
 *
 * Wave BLACKBOARD-CORE. Pure function. Given a snapshot of a region
 * + the KS registry + a competence lookup, returns the KS to activate
 * next, or null if no KS scores above the dormant floor.
 *
 * Does NOT mutate state — does NOT call the picked KS — only emits a
 * `ControlActivation` envelope. The agent-runtime listens to these
 * events and dispatches.
 *
 * Determinism: ties (rare under live competence measurements) are
 * broken by `ks.id` ascending so tests are repeatable.
 *
 * Spec: Docs/DESIGN/BLACKBOARD_SOTA_2026.md §3.2, §6.
 */

import {
  BLACKBOARD_CONSTANTS,
  type ControlActivation,
  type KnowledgeSource,
  type Region,
  type RegionKind,
} from '../types.js';
import { scoreActivation } from './activation-policy.js';

/**
 * Look up a KS's measured competence on a region kind. Returns a
 * number in [0, 1]. The fallback (0.5) is applied at the call site
 * inside the control shell — this port returns null when no
 * measurement exists so the caller can choose the fallback policy.
 *
 * In production this wraps `@borjie/capability-catalogue`'s
 * measurement aggregator. Tests inject a deterministic in-memory
<<<<<<< Updated upstream
 * map (see `__fixtures__/control-shell.ts`).
=======
 * map (see `__fixtures__/competence-lookup.ts`).
>>>>>>> Stashed changes
 */
export interface CompetenceLookupPort {
  scoreFor(
    tenantId: string,
    ksName: string,
    regionKind: RegionKind,
  ): Promise<number | null>;
}

/**
 * Look up how long ago a KS last spoke in a region. Returns Δt in
 * milliseconds; null means "never spoke" → treat as Δt = ∞ (fully
 * fresh). The runtime caches this from the last post per (ks_id,
 * region_id) for speed.
 */
export interface KSActivityClockPort {
  lastSpokeAgoMs(
    tenantId: string,
    ksId: string,
    regionId: string,
  ): Promise<number | null>;
}

export interface PickNextInput {
  readonly region: Region;
  readonly candidates: ReadonlyArray<KnowledgeSource>;
}

export interface ControlShellDeps {
  readonly competence: CompetenceLookupPort;
  readonly activityClock: KSActivityClockPort;
  readonly now?: () => Date;
}

export interface ControlShell {
  pickNext(input: PickNextInput): Promise<ControlActivation | null>;
}

export function createControlShell(deps: ControlShellDeps): ControlShell {
  const { competence, activityClock } = deps;
  const now = deps.now ?? (() => new Date());

  return {
    async pickNext(input) {
      const region = input.region;
      // Filter candidates by region kind. An empty region_filter
      // means the KS applies to all region kinds.
      const eligible = input.candidates.filter(
        (ks) =>
          ks.regionFilter.length === 0 ||
          ks.regionFilter.includes(region.regionKind),
      );
      if (eligible.length === 0) return null;

      const scored = await Promise.all(
        eligible.map(async (ks) => {
          const lastMs = await activityClock.lastSpokeAgoMs(
            region.tenantId,
            ks.id,
            region.id,
          );
<<<<<<< Updated upstream
          // A KS that has never spoken in this region is treated as
          // "perfectly fresh" — Δt = 0 → freshness = 1.0 — so the
          // first-mover can be picked on priority × competence alone.
          // (The exponential decay penalises *recent* activation, not
          // never-activation; see spec §3.2.)
          const deltaMs = lastMs ?? 0;
=======
          // Δt = ∞ if the KS has never spoken (rewards first-mover).
          // We model "∞" as Number.MAX_SAFE_INTEGER which makes
          // freshness saturate at 1.0.
          const deltaMs = lastMs ?? Number.MAX_SAFE_INTEGER;
>>>>>>> Stashed changes
          const measured = await competence.scoreFor(
            region.tenantId,
            ks.ksName,
            region.regionKind,
          );
          // Capability-catalogue fallback (spec §3.2).
          const competenceScore = measured ?? 0.5;
          const result = scoreActivation({
            priority: ks.priority,
            deltaMs,
            competence: competenceScore,
          });
          return { ks, result };
        }),
      );

      // Highest score wins; ties broken by `ks.id` ascending for
      // deterministic test output.
      const sorted = scored.slice().sort((a, b) => {
        if (b.result.score !== a.result.score) {
          return b.result.score - a.result.score;
        }
        return a.ks.id.localeCompare(b.ks.id);
      });

      const top = sorted[0];
      if (top === undefined) return null;
      if (top.result.score < BLACKBOARD_CONSTANTS.CONTROL_SHELL_FLOOR) {
        return null;
      }

      const activation: ControlActivation = Object.freeze({
        tenantId: region.tenantId,
        regionId: region.id,
        ksId: top.ks.id,
        ksName: top.ks.ksName,
        score: top.result.score,
        breakdown: Object.freeze({
          priority: top.result.priority,
          freshness: top.result.freshness,
          competence: top.result.competence,
        }),
        decidedAt: now(),
      });
      return activation;
    },
  };
}
