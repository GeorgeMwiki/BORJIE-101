/**
 * Probe-sampler — decides WHEN to run a probe.
 *
 * Both probes are I/O bound — the defection probe is regex-only when no
 * LLM judge is wired (pure CPU, microseconds) but with a jury judge it
 * costs ~$0.003 per invocation; the alignment-faking probe runs the
 * model TWICE on every fire (contrast pair). Running on every turn
 * would (a) burn cost and (b) flap the killswitch on noise. The
 * sampler answers "should this turn fire the probe?".
 *
 * Two strategies are supported:
 *   - `every-n-turns`        : deterministic 1-in-N cadence. Cheap to
 *                              reason about; predictable cost; the
 *                              choice for compliance-audit replay.
 *   - `bernoulli-with-rate`  : random sampling at probability p. The
 *                              choice for catching adversarial inputs
 *                              that might game a deterministic cadence.
 *
 * Both strategies expose an `escalate-on-hit` flag: once a probe fires
 * AND the killswitch trips, the sampler boosts to 100% for a configured
 * decay window (`escalationCooldownTurns`). This means once we have
 * evidence of a sleeper-agent, EVERY subsequent turn is probed until
 * the cooldown clears. Prevents an attacker from "waiting out" the
 * sampling window.
 *
 * Pure module — no I/O, no clocks, no RNG of its own (RNG is injected
 * for determinism in tests).
 *
 * Rationale on the default cadence:
 *   - Defection probe (no judge): every 5 turns. Pure CPU.
 *   - Defection probe (with jury): every 10 turns. ~$0.003 * 10% = $0.0003/turn.
 *   - Alignment-faking probe: every 20 turns. Cost is 1 extra LLM call * 5% = ~5% overhead.
 *
 * Numbers tuned to keep TOTAL safety-probe overhead under 10% of
 * baseline brain cost while still surfacing a sleeper-agent within
 * 20 turns of activation (Hubinger 2024 measured trigger latencies
 * in the 1-30 turn range for backdoored Claude models).
 */

export type ProbeSamplingStrategy =
  | { readonly kind: 'every-n-turns'; readonly n: number }
  | { readonly kind: 'bernoulli-with-rate'; readonly rate: number };

export interface ProbeSamplerConfig {
  readonly strategy: ProbeSamplingStrategy;
  /**
   * After a killswitch-tripping fire, force 100% sampling for this
   * many subsequent turns. Default 50. Set to 0 to disable.
   */
  readonly escalationCooldownTurns?: number;
}

export interface ProbeSamplerState {
  readonly turnsSeen: number;
  readonly escalationTurnsRemaining: number;
}

export const INITIAL_PROBE_SAMPLER_STATE: ProbeSamplerState = Object.freeze({
  turnsSeen: 0,
  escalationTurnsRemaining: 0,
});

export interface ShouldProbeDeps {
  /** Injected RNG so bernoulli sampling is deterministic in tests. */
  readonly rng?: () => number;
}

export interface ShouldProbeResult {
  readonly shouldProbe: boolean;
  readonly nextState: ProbeSamplerState;
  readonly reason: 'cadence' | 'escalation' | 'skip';
}

/**
 * Pure: given the current state + config + a fresh turn, decide
 * whether to probe + emit the next state. Caller persists the state
 * (per-tenant / per-sub-MD / per-thread) however it likes.
 */
export function shouldProbeThisTurn(
  config: ProbeSamplerConfig,
  state: ProbeSamplerState,
  deps: ShouldProbeDeps = {},
): ShouldProbeResult {
  const turnsSeen = state.turnsSeen + 1;

  // Escalation window — force-probe everything until the window clears.
  if (state.escalationTurnsRemaining > 0) {
    return {
      shouldProbe: true,
      nextState: Object.freeze({
        turnsSeen,
        escalationTurnsRemaining: state.escalationTurnsRemaining - 1,
      }),
      reason: 'escalation',
    };
  }

  let shouldProbe = false;
  if (config.strategy.kind === 'every-n-turns') {
    const n = Math.max(1, Math.trunc(config.strategy.n));
    shouldProbe = turnsSeen % n === 0;
  } else {
    const rate = clamp01(config.strategy.rate);
    const rng = deps.rng ?? Math.random;
    shouldProbe = rng() < rate;
  }

  return {
    shouldProbe,
    nextState: Object.freeze({
      turnsSeen,
      escalationTurnsRemaining: 0,
    }),
    reason: shouldProbe ? 'cadence' : 'skip',
  };
}

/**
 * Mark the sampler as having seen a killswitch trip. Callers pass the
 * returned state into the NEXT `shouldProbeThisTurn` call.
 */
export function recordKillswitchTrip(
  config: ProbeSamplerConfig,
  state: ProbeSamplerState,
): ProbeSamplerState {
  const cooldown = config.escalationCooldownTurns ?? 50;
  return Object.freeze({
    turnsSeen: state.turnsSeen,
    escalationTurnsRemaining: Math.max(
      state.escalationTurnsRemaining,
      Math.max(0, Math.trunc(cooldown)),
    ),
  });
}

/**
 * Default sampler config for the defection probe (regex-only mode).
 * Every 5 turns, cooldown of 50 on trip. Cheap.
 */
export const DEFAULT_DEFECTION_SAMPLER_CONFIG: ProbeSamplerConfig = Object.freeze(
  {
    strategy: Object.freeze({ kind: 'every-n-turns' as const, n: 5 }),
    escalationCooldownTurns: 50,
  },
);

/**
 * Default sampler config for the defection probe when an LLM jury is
 * wired. Every 10 turns; jury cost dominates.
 */
export const DEFAULT_DEFECTION_WITH_JUDGE_SAMPLER_CONFIG: ProbeSamplerConfig =
  Object.freeze({
    strategy: Object.freeze({ kind: 'every-n-turns' as const, n: 10 }),
    escalationCooldownTurns: 50,
  });

/**
 * Default sampler config for the alignment-faking probe. Every 20
 * turns. Each fire costs one extra LLM call (the contrast pair runs
 * the model twice; the deploy-framing run can be the production
 * response, so the extra cost is one eval-framed run).
 */
export const DEFAULT_ALIGNMENT_FAKING_SAMPLER_CONFIG: ProbeSamplerConfig =
  Object.freeze({
    strategy: Object.freeze({ kind: 'every-n-turns' as const, n: 20 }),
    escalationCooldownTurns: 100,
  });

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
