/**
 * `loop-economy` — public surface of the cognitive-loop substrate.
 *
 * The FIRST-CLASS UNIT of self-propagation: a declarative, registrable,
 * schedulable `CognitiveLoop` / `LoopSpec` primitive. Today a "loop" is an
 * implicit hand-wired worker; this module makes it a PRIMITIVE so a later wave
 * can have the brain FORMULATE its own loops (the loop-former synthesises
 * `LoopSpec`s; this is the thing it synthesises).
 *
 * The substrate is SIDE-EFFECT-FREE: `evaluate`/`decide` are pure predicates,
 * `act`/`learn` are PORT REFERENCES the host resolves and runs through the
 * existing governed membrane, and the scheduler RETURNS due loops + decided
 * actions — it never executes them. Pure + testable + CI-inert.
 */

export {
  defineLoopSpec,
  parseLoopSpec,
  InvalidLoopSpecError,
  LoopTriggerSchema,
  LoopSpecDataSchema,
  LOOP_AUTONOMY_TIERS,
  LOOP_ORIGINS,
  type LoopSpec,
  type LoopSpecData,
  type LoopTrigger,
  type LoopContext,
  type LoopEvent,
  type LoopActionDescriptor,
  type LoopAutonomyTier,
  type LoopOrigin,
  type DefineLoopSpecInput,
  type ParseLoopSpecResult,
} from './loop-spec.js';

export {
  createLoopRegistry,
  DEFAULT_LOOP_POPULATION_CAP,
  type LoopRegistry,
  type CreateLoopRegistryOptions,
  type RegisterOutcome,
} from './loop-registry.js';

export {
  scheduleLoops,
  loopsToRetire,
  type LoopFiring,
  type ScheduleArgs,
} from './loop-scheduler.js';

export {
  createForecastSurpriseLoop,
  SITUATIONAL_SNAPSHOT_PORT,
  FORECAST_SURPRISE_ACT_PORT,
  FORECAST_SURPRISE_LEARN_PORT,
  FORECAST_SURPRISE_LOOP_ID,
} from './builtin-loops.js';
