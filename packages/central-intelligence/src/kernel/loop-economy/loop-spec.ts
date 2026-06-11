/**
 * loop-spec — the declarative `CognitiveLoop` / `LoopSpec` PRIMITIVE.
 *
 * A "loop" today is an implicit, hand-wired worker: the EstateMind slow loop,
 * the consolidation tick, the proactive wake-loop — each a bespoke piece of
 * orchestration with no shared shape. This module makes a loop a FIRST-CLASS,
 * declarative, registrable UNIT so a later wave can have the brain FORMULATE
 * its own loops (the loop-former synthesises `LoopSpec`s; this is the thing it
 * synthesises). It is the loop-of-loops substrate — the seed of self-
 * propagation.
 *
 * GOVERNANCE — this substrate is SIDE-EFFECT-FREE by construction:
 *   - `evaluate` is a PURE predicate over a context → should-this-fire.
 *   - `decide` returns an INTENDED action descriptor — it NEVER executes.
 *   - `act` / `learn` are PORT REFERENCES (opaque string handles) the HOST
 *     resolves and runs through the EXISTING governed membrane. The substrate
 *     never holds a callable side-effecting function, so it can never act,
 *     mutate, deploy, or reach the network. It is pure + testable + CI-inert.
 *
 * A `LoopSpec` carries NO behaviour-changing power: registering one does not
 * run it; the host scheduler RETURNS due loops + their decided actions, and a
 * separate host stage runs those through the governed membrane (four-eye /
 * kill-switch / policy-gate) exactly as it does for every other proposed
 * action. The autonomyTier on a loop is advisory metadata the host membrane
 * reads — it can NEVER widen what the membrane already permits.
 *
 * Pure: no I/O, no clock read (the caller passes `nowMs`), no throws on the
 * happy path; `defineLoopSpec` validates with zod and throws a typed error ON
 * MALFORMED INPUT ONLY (a programmer error at definition time, never inside a
 * turn/cron/boot — the honest-degrade rail is the host's, which calls the
 * safe `parseLoopSpec` form).
 */

import { z } from 'zod';
import { DELEGATION_TIERS } from '../autonomy/types.js';

/**
 * The autonomy tier a loop's decided action defaults to. Reuses the canonical
 * four-tier delegation ladder (T0 inform-only → T3 irrevocable) so a loop's
 * advisory tier speaks the SAME vocabulary the autonomy membrane already
 * enforces — a loop can never invent a tier the membrane doesn't understand.
 */
export const LOOP_AUTONOMY_TIERS = DELEGATION_TIERS;
export type LoopAutonomyTier = (typeof LOOP_AUTONOMY_TIERS)[number];

/** Where a loop came from: a hand-authored builtin or a brain-synthesised one. */
export const LOOP_ORIGINS = ['builtin', 'formed'] as const;
export type LoopOrigin = (typeof LOOP_ORIGINS)[number];

/**
 * A loop's trigger — a discriminated union. A `tick` loop fires on a periodic
 * cadence (`everyMs`); an `event` loop fires when a named event type is seen.
 * The trigger is pure DATA — the scheduler interprets it; the spec never wires
 * a timer or a subscription itself.
 */
export const LoopTriggerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('tick'),
    /** Cadence in ms. Positive + finite. The scheduler decides due-ness. */
    everyMs: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('event'),
    /** The event type this loop reacts to (opaque to the substrate). */
    eventType: z.string().min(1),
  }),
]);
export type LoopTrigger = z.infer<typeof LoopTriggerSchema>;

/**
 * The opaque CONTEXT a loop reads. The substrate stays domain-free: a loop's
 * `evaluate`/`decide` read a frozen JSON-ish bag the HOST populates from the
 * organs named in `organBindings`. The substrate never reaches into an organ
 * itself — it only sees the snapshot the host folded for it. `nowMs` + an
 * optional firing `event` are always present; everything else is host data.
 */
export interface LoopContext {
  /** Read instant — the caller's clock, never read inside the substrate. */
  readonly nowMs: number;
  /** The event that woke an `event` loop (absent on a pure `tick`). */
  readonly event?: LoopEvent;
  /** Host-folded organ readings, keyed by the names in `organBindings`. */
  readonly ports: Readonly<Record<string, unknown>>;
}

/** A host event offered to the scheduler. Opaque payload; typed envelope. */
export interface LoopEvent {
  readonly type: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

/**
 * The INTENDED action a loop's `decide` returns. This is a DESCRIPTOR ONLY —
 * it names the `actPort` the host should resolve and the args to pass; it
 * holds NO callable and performs NO side effect. The host runs `actPort`
 * through the governed membrane. `null` from `decide` means "fired but chose
 * to do nothing this time" (observe-only).
 */
export interface LoopActionDescriptor {
  /** The port reference the host resolves + runs through the membrane. */
  readonly actPort: string;
  /** The advisory tier this action defaults to (host membrane may raise). */
  readonly autonomyTier: LoopAutonomyTier;
  /** A locale-free one-line rationale carried into the proposal/audit. */
  readonly summary: string;
  /** Opaque, JSON-serialisable args for the host's act port. */
  readonly args: Readonly<Record<string, unknown>>;
}

/**
 * The declarative cognitive loop. `evaluate`/`decide`/`retireCondition` are
 * PURE functions over a `LoopContext`; `actPort`/`learnPort` are PORT
 * REFERENCES (string handles) — NOT callables. The substrate can therefore
 * never execute a side effect.
 */
export interface LoopSpec {
  readonly id: string;
  readonly title: string;
  readonly trigger: LoopTrigger;
  /** Named ports this loop reads — the host folds these into `ctx.ports`. */
  readonly organBindings: ReadonlyArray<string>;
  /** PURE predicate: given the context, should this loop fire now? */
  evaluate(ctx: LoopContext): boolean;
  /**
   * PURE decision: given a context it has decided to fire on, return the
   * INTENDED action descriptor (or `null` for observe-only). NEVER executes.
   */
  decide(ctx: LoopContext): LoopActionDescriptor | null;
  /** Port reference the host runs through the governed membrane. */
  readonly actPort: string;
  /** Port reference for the host's reflexion/efficacy hook. */
  readonly learnPort: string;
  /** PURE predicate: should this loop be retired (e.g. stale/ineffective)? */
  retireCondition(ctx: LoopContext): boolean;
  /** Running efficacy score in [0,1]; `null` until the host scores it. */
  readonly efficacy: number | null;
  /** Advisory default tier for this loop's decided action. */
  readonly autonomyTier: LoopAutonomyTier;
  readonly createdAtMs: number;
  readonly origin: LoopOrigin;
}

/**
 * Zod schema for the SERIALISABLE facets of a LoopSpec (everything except the
 * three pure function hooks, which zod can validate as `z.function()` shapes
 * but cannot serialise). Used by the typed factory + the safe parse form.
 */
const LoopSpecDataSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  trigger: LoopTriggerSchema,
  organBindings: z.array(z.string().min(1)).readonly(),
  actPort: z.string().min(1),
  learnPort: z.string().min(1),
  efficacy: z.number().min(0).max(1).nullable(),
  autonomyTier: z.enum(LOOP_AUTONOMY_TIERS),
  createdAtMs: z.number().int().nonnegative(),
  origin: z.enum(LOOP_ORIGINS),
});

/** The data-only projection of a LoopSpec (no function hooks). */
export type LoopSpecData = z.infer<typeof LoopSpecDataSchema>;

/** Thrown ONLY at definition time on a malformed spec (programmer error). */
export class InvalidLoopSpecError extends Error {
  constructor(
    message: string,
    readonly issues: z.ZodIssue[],
  ) {
    super(message);
    this.name = 'InvalidLoopSpecError';
  }
}

/**
 * Input to the typed factory. The three pure hooks default to inert
 * implementations so a minimal spec is valid: a loop that never fires, never
 * decides, never retires — the safest possible default.
 */
export interface DefineLoopSpecInput {
  readonly id: string;
  readonly title: string;
  readonly trigger: LoopTrigger;
  readonly organBindings?: ReadonlyArray<string>;
  readonly evaluate?: (ctx: LoopContext) => boolean;
  readonly decide?: (ctx: LoopContext) => LoopActionDescriptor | null;
  readonly actPort: string;
  readonly learnPort: string;
  readonly retireCondition?: (ctx: LoopContext) => boolean;
  readonly efficacy?: number | null;
  readonly autonomyTier?: LoopAutonomyTier;
  readonly createdAtMs: number;
  readonly origin?: LoopOrigin;
}

/**
 * The typed factory. Validates the serialisable facets with zod, then assembles
 * an immutable, frozen LoopSpec with safe inert defaults for the optional pure
 * hooks. Throws {@link InvalidLoopSpecError} on malformed DATA (definition-time
 * programmer error) — the host uses {@link parseLoopSpec} when the input is
 * untrusted (e.g. a brain-formed spec) to keep the honest-degrade rail.
 */
export function defineLoopSpec(input: DefineLoopSpecInput): LoopSpec {
  const data: LoopSpecData = {
    id: input.id,
    title: input.title,
    trigger: input.trigger,
    organBindings: input.organBindings ?? [],
    actPort: input.actPort,
    learnPort: input.learnPort,
    efficacy: input.efficacy ?? null,
    autonomyTier: input.autonomyTier ?? 'T1',
    createdAtMs: input.createdAtMs,
    origin: input.origin ?? 'builtin',
  };
  const parsed = LoopSpecDataSchema.safeParse(data);
  if (!parsed.success) {
    throw new InvalidLoopSpecError(
      `invalid LoopSpec "${String(input.id)}": ${parsed.error.message}`,
      parsed.error.issues,
    );
  }
  const spec: LoopSpec = {
    id: parsed.data.id,
    title: parsed.data.title,
    trigger: parsed.data.trigger,
    organBindings: Object.freeze([...parsed.data.organBindings]),
    evaluate: input.evaluate ?? (() => false),
    decide: input.decide ?? (() => null),
    actPort: parsed.data.actPort,
    learnPort: parsed.data.learnPort,
    retireCondition: input.retireCondition ?? (() => false),
    efficacy: parsed.data.efficacy,
    autonomyTier: parsed.data.autonomyTier,
    createdAtMs: parsed.data.createdAtMs,
    origin: parsed.data.origin,
  };
  return Object.freeze(spec);
}

/**
 * Safe parse form for UNTRUSTED specs (e.g. a brain-formed `LoopSpec`). Returns
 * a discriminated result instead of throwing, so the host can degrade honestly
 * (drop the malformed loop, log, continue) inside a cron/turn/boot — never let
 * a bad synthesised loop crash the loop economy.
 */
export type ParseLoopSpecResult =
  | { readonly ok: true; readonly spec: LoopSpec }
  | { readonly ok: false; readonly issues: z.ZodIssue[] };

export function parseLoopSpec(input: DefineLoopSpecInput): ParseLoopSpecResult {
  const parsed = LoopSpecDataSchema.safeParse({
    id: input.id,
    title: input.title,
    trigger: input.trigger,
    organBindings: input.organBindings ?? [],
    actPort: input.actPort,
    learnPort: input.learnPort,
    efficacy: input.efficacy ?? null,
    autonomyTier: input.autonomyTier ?? 'T1',
    createdAtMs: input.createdAtMs,
    origin: input.origin ?? 'builtin',
  });
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues };
  }
  return { ok: true, spec: defineLoopSpec(input) };
}

/** Re-export the schema so the host/registry can validate persisted rows. */
export { LoopSpecDataSchema };
