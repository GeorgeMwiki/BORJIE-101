/**
 * loop-registry — the in-memory population of `LoopSpec`s.
 *
 * The registry is the BODY of the loop economy: it holds the live set of
 * cognitive loops, tolerates re-registration (last-write-wins so a re-formed
 * loop supersedes its predecessor), and enforces a POPULATION CAP — the
 * synaptic-pruning seed. When the cap is reached a new registration only
 * succeeds if it can EVICT the lowest-efficacy resident loop; an
 * unscored/builtin loop is never silently evicted by a lower-value newcomer.
 *
 * GOVERNANCE — the registry holds DATA only. It never runs a loop, never
 * resolves a port, never reaches a side effect. The host scheduler reads it
 * and the host membrane runs the decided actions. Pure in-memory + total: no
 * throws on the API surface (register returns a typed result), no I/O.
 *
 * Immutability: the registry keeps an internal `Map`, but every read returns a
 * fresh array / the frozen spec; updates build a NEW spec (efficacy update is
 * a new frozen object) rather than mutating a resident one.
 */

import type { LoopSpec } from './loop-spec.js';

/** Default ceiling on the live loop population (bounds memory + scheduler cost). */
export const DEFAULT_LOOP_POPULATION_CAP = 256;

/** The outcome of attempting to register a loop. */
export type RegisterOutcome =
  | { readonly ok: true; readonly evicted: LoopSpec | null }
  | { readonly ok: false; readonly reason: 'population_cap_reached' };

export interface LoopRegistry {
  /**
   * Register (or replace) a loop. Re-registering an existing id is last-wins
   * and never trips the cap (the population count is unchanged). A NEW id at
   * the cap succeeds only by evicting the lowest-efficacy resident whose
   * efficacy is strictly lower than the newcomer's; otherwise it is rejected.
   */
  register(spec: LoopSpec): RegisterOutcome;
  get(id: string): LoopSpec | undefined;
  list(): ReadonlyArray<LoopSpec>;
  /** Loops that have not been retired (retirement is host-driven via retire). */
  listActive(): ReadonlyArray<LoopSpec>;
  /**
   * Loops whose `tick` cadence is DUE at `nowMs` (event loops are never "due"
   * on a bare tick — they fire only when their event arrives, via the
   * scheduler). Pure read; does not advance any internal clock.
   */
  listDue(nowMs: number): ReadonlyArray<LoopSpec>;
  /** Remove a loop by id. Returns the removed spec (or undefined). */
  retire(id: string): LoopSpec | undefined;
  /**
   * Replace a loop's efficacy with a new clamped [0,1] score, building a NEW
   * frozen spec. Returns the updated spec, or undefined if the id is unknown.
   */
  updateEfficacy(id: string, efficacy: number): LoopSpec | undefined;
  /** Current live population size. */
  size(): number;
}

export interface CreateLoopRegistryOptions {
  /** Population ceiling; defaults to {@link DEFAULT_LOOP_POPULATION_CAP}. */
  readonly populationCap?: number;
}

/** Numeric efficacy for eviction comparison; unscored (`null`) sorts LOWEST. */
function efficacyRank(spec: LoopSpec): number {
  return spec.efficacy ?? -1;
}

/** Find the resident with the strictly-lowest efficacy (eviction candidate). */
function lowestEfficacyResident(
  loops: ReadonlyArray<LoopSpec>,
): LoopSpec | undefined {
  if (loops.length === 0) return undefined;
  return loops.reduce((lowest, cur) =>
    efficacyRank(cur) < efficacyRank(lowest) ? cur : lowest,
  );
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * `listDue` predicate for a single loop. A `tick` loop is due when at least
 * one full cadence has elapsed since it was created — i.e. the loop has had a
 * chance to fire. The scheduler owns the "since last fire" bookkeeping; the
 * registry's cheaper question is "is this tick loop eligible at all at
 * `nowMs`?" so a freshly-registered loop with a future `createdAtMs` is not
 * yet due.
 */
function tickLoopDue(spec: LoopSpec, nowMs: number): boolean {
  if (spec.trigger.kind !== 'tick') return false;
  return nowMs >= spec.createdAtMs + spec.trigger.everyMs;
}

/**
 * Construct a pure in-memory loop registry. No I/O, no clock read of its own.
 */
export function createLoopRegistry(
  options: CreateLoopRegistryOptions = {},
): LoopRegistry {
  const cap = options.populationCap ?? DEFAULT_LOOP_POPULATION_CAP;
  const loops = new Map<string, LoopSpec>();

  function register(spec: LoopSpec): RegisterOutcome {
    // Re-registration of a known id is last-wins; population unchanged.
    if (loops.has(spec.id)) {
      loops.set(spec.id, spec);
      return { ok: true, evicted: null };
    }
    if (loops.size < cap) {
      loops.set(spec.id, spec);
      return { ok: true, evicted: null };
    }
    // At the cap: only admit a newcomer that out-scores the weakest resident.
    const victim = lowestEfficacyResident([...loops.values()]);
    if (victim === undefined || efficacyRank(spec) <= efficacyRank(victim)) {
      return { ok: false, reason: 'population_cap_reached' };
    }
    loops.delete(victim.id);
    loops.set(spec.id, spec);
    return { ok: true, evicted: victim };
  }

  function updateEfficacy(id: string, efficacy: number): LoopSpec | undefined {
    const current = loops.get(id);
    if (current === undefined) return undefined;
    const next: LoopSpec = Object.freeze({ ...current, efficacy: clamp01(efficacy) });
    loops.set(id, next);
    return next;
  }

  return {
    register,
    get: (id) => loops.get(id),
    list: () => [...loops.values()],
    // Retirement is host-driven removal; a present loop is by definition
    // active in this pure registry (it folds no time-based liveness itself).
    listActive: () => [...loops.values()],
    listDue: (nowMs) => [...loops.values()].filter((s) => tickLoopDue(s, nowMs)),
    retire: (id) => {
      const existing = loops.get(id);
      if (existing === undefined) return undefined;
      loops.delete(id);
      return existing;
    },
    updateEfficacy,
    size: () => loops.size,
  };
}
