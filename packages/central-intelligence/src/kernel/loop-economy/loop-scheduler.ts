/**
 * loop-scheduler — the PURE selector that decides which loops fire.
 *
 * Given the registry, a `nowMs`, an optional firing `event`, and the host-
 * folded organ `ports`, the scheduler returns the ORDERED list of loops whose
 * trigger + `evaluate` both fire, each paired with the action `decide`
 * returned. It does NOT execute `act` — it RETURNS the due loops + decided
 * actions for the HOST to run through the governed membrane.
 *
 * This is the side-effect-free heart of the loop economy: the scheduler reads
 * data, runs the loops' PURE predicates, and hands the host a manifest. The
 * host (api-gateway composition root, a cron, a stage bus) is the only thing
 * that resolves a loop's `actPort`/`learnPort` and runs it through four-eye /
 * kill-switch / policy-gate. Keeping selection pure makes the substrate fully
 * testable and CI-inert: with no host, nothing ever runs.
 *
 * GOVERNANCE: the scheduler can never act. A `LoopFiring` carries a DESCRIPTOR
 * (the decided action), not a callable. The autonomyTier on the descriptor is
 * advisory metadata the host membrane reads — selection here never widens what
 * the membrane permits.
 *
 * ORDERING: firings are sorted (a) by the action's autonomy tier — lower-blast
 * (T0 inform-only) first so the safest signals lead — then (b) by the loop's
 * efficacy descending (the proven loops lead within a tier), then (c) by loop
 * id for a stable, deterministic order. Deterministic + total: a loop whose
 * `evaluate`/`decide` THROWS is treated as "did not fire" (honest-degrade — a
 * malformed formed loop can never crash a scheduling pass).
 */

import type { LoopRegistry } from './loop-registry.js';
import type {
  LoopActionDescriptor,
  LoopAutonomyTier,
  LoopContext,
  LoopEvent,
  LoopSpec,
} from './loop-spec.js';

/** A loop that fired this pass + the action it decided (descriptor, not run). */
export interface LoopFiring {
  readonly loop: LoopSpec;
  /** The decided action descriptor, or `null` for an observe-only firing. */
  readonly action: LoopActionDescriptor | null;
}

export interface ScheduleArgs {
  readonly registry: LoopRegistry;
  /** Read instant — the caller's clock; the scheduler never reads a clock. */
  readonly nowMs: number;
  /** A firing event, if this pass was woken by one. */
  readonly event?: LoopEvent;
  /** Host-folded organ readings keyed by each loop's `organBindings` names. */
  readonly ports?: Readonly<Record<string, unknown>>;
}

/** Lower index = lower blast radius = scheduled earlier. */
const TIER_ORDER: Readonly<Record<LoopAutonomyTier, number>> = Object.freeze({
  T0: 0,
  T1: 1,
  T2: 2,
  T3: 3,
});

/** Build the immutable context a loop's pure hooks read this pass. */
function buildContext(args: ScheduleArgs): LoopContext {
  const base = {
    nowMs: args.nowMs,
    ports: args.ports ?? {},
  };
  // exactOptionalPropertyTypes: only attach `event` when one is present.
  return Object.freeze(args.event === undefined ? base : { ...base, event: args.event });
}

/**
 * Does this loop's TRIGGER fire this pass? A `tick` loop is eligible when at
 * least one cadence has elapsed since creation (the registry's `listDue`
 * gate); an `event` loop fires only when a matching event arrived this pass.
 */
function triggerFires(spec: LoopSpec, args: ScheduleArgs): boolean {
  if (spec.trigger.kind === 'tick') {
    return args.nowMs >= spec.createdAtMs + spec.trigger.everyMs;
  }
  return args.event !== undefined && args.event.type === spec.trigger.eventType;
}

/**
 * Run a loop's PURE `evaluate`, defending against a throw from a malformed
 * (e.g. brain-formed) loop — a thrown predicate degrades to "did not fire"
 * so one bad loop can never crash the whole scheduling pass.
 */
function evaluatesTrue(spec: LoopSpec, ctx: LoopContext): boolean {
  try {
    return spec.evaluate(ctx) === true;
  } catch {
    return false;
  }
}

/** Run a loop's PURE `decide`, degrading a throw to a null (observe-only). */
function safeDecide(spec: LoopSpec, ctx: LoopContext): LoopActionDescriptor | null {
  try {
    return spec.decide(ctx);
  } catch {
    return null;
  }
}

/** Stable, deterministic firing order: tier, then efficacy desc, then id. */
function compareFirings(a: LoopFiring, b: LoopFiring): number {
  const ta = TIER_ORDER[a.action?.autonomyTier ?? a.loop.autonomyTier];
  const tb = TIER_ORDER[b.action?.autonomyTier ?? b.loop.autonomyTier];
  if (ta !== tb) return ta - tb;
  const ea = a.loop.efficacy ?? -1;
  const eb = b.loop.efficacy ?? -1;
  if (ea !== eb) return eb - ea;
  return a.loop.id < b.loop.id ? -1 : a.loop.id > b.loop.id ? 1 : 0;
}

/**
 * Select the ordered loops that fire this pass + their decided actions. PURE:
 * reads the registry, runs the loops' pure hooks, returns a manifest. NEVER
 * executes a loop's `act`/`learn` port — that is the host's membrane-gated job.
 */
export function scheduleLoops(args: ScheduleArgs): ReadonlyArray<LoopFiring> {
  const ctx = buildContext(args);
  const firings: LoopFiring[] = [];
  for (const spec of args.registry.listActive()) {
    if (!triggerFires(spec, args)) continue;
    if (!evaluatesTrue(spec, ctx)) continue;
    firings.push({ loop: spec, action: safeDecide(spec, ctx) });
  }
  return firings.sort(compareFirings);
}

/**
 * Convenience selector for the host's RETIREMENT sweep: the loops whose pure
 * `retireCondition` fires this pass. The host removes these from the registry
 * (synaptic pruning of stale/ineffective loops). PURE; a throwing condition
 * degrades to "do not retire" (we never prune on an error).
 */
export function loopsToRetire(args: ScheduleArgs): ReadonlyArray<LoopSpec> {
  const ctx = buildContext(args);
  const out: LoopSpec[] = [];
  for (const spec of args.registry.listActive()) {
    try {
      if (spec.retireCondition(ctx) === true) out.push(spec);
    } catch {
      // honest-degrade: never retire on an error.
    }
  }
  return out;
}
