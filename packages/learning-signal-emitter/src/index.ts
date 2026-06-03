/**
 * `@borjie/learning-signal-emitter` — public surface.
 *
 * One (action, outcome) → reward-scored → per-tier isolation-gated → fanned
 * out to injected sinks (belief / reflexion / mastery / pattern / persona /
 * preference). Ported from LITFIN (LP-17). The emitter never writes a belief
 * directly — the belief sink wraps the belief-engine convince-loop.
 *
 * Wire the sinks at the kernel composition root. The belief sink calls
 * `@borjie/belief-engine` reviseBelief; the reflexion sink (LP-05) calls the
 * memory-v2 reflective store via `@borjie/memory-port-extensions`.
 */

// Types
export * from './types.js';

// Reward model (pure)
export {
  scoreAction,
  rewardOf,
  DEFAULT_WEIGHTS,
  type ScoreActionInput,
} from './reward-model.js';

// Per-tier isolation gate (pure)
export {
  enforceIsolation,
  isolationAllowed,
  DEFAULT_K_ANONYMITY,
  type IsolationCheckInput,
  type IsolationResult,
} from './per-tier-isolation.js';

// Signal emitter + fan-out
export {
  emitSignal,
  buildSignal,
  buildSignalHash,
  routePlan,
  type SignalSinks,
  type EmitInput,
} from './signal-emitter.js';
