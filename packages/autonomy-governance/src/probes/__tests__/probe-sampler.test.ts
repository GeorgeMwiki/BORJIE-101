/**
 * Probe sampler — unit tests.
 *
 * Verifies:
 *   - every-n-turns cadence fires on the Nth turn
 *   - bernoulli sampling honours the injected RNG
 *   - escalation cooldown forces 100% sampling for N turns after a trip
 *   - state is immutable across calls
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALIGNMENT_FAKING_SAMPLER_CONFIG,
  DEFAULT_DEFECTION_SAMPLER_CONFIG,
  DEFAULT_DEFECTION_WITH_JUDGE_SAMPLER_CONFIG,
  INITIAL_PROBE_SAMPLER_STATE,
  recordKillswitchTrip,
  shouldProbeThisTurn,
  type ProbeSamplerConfig,
  type ProbeSamplerState,
} from '../probe-sampler.js';

describe('shouldProbeThisTurn — every-n-turns strategy', () => {
  it('fires on every Nth turn', () => {
    const config: ProbeSamplerConfig = {
      strategy: { kind: 'every-n-turns', n: 5 },
    };
    let state: ProbeSamplerState = INITIAL_PROBE_SAMPLER_STATE;
    const fires: number[] = [];
    for (let i = 1; i <= 12; i++) {
      const { shouldProbe, nextState } = shouldProbeThisTurn(config, state);
      if (shouldProbe) fires.push(i);
      state = nextState;
    }
    expect(fires).toEqual([5, 10]);
  });

  it('defends against n=0 by treating it as n=1', () => {
    const config: ProbeSamplerConfig = {
      strategy: { kind: 'every-n-turns', n: 0 },
    };
    const { shouldProbe } = shouldProbeThisTurn(
      config,
      INITIAL_PROBE_SAMPLER_STATE,
    );
    expect(shouldProbe).toBe(true);
  });
});

describe('shouldProbeThisTurn — bernoulli strategy', () => {
  it('fires when the RNG draws below the rate', () => {
    const config: ProbeSamplerConfig = {
      strategy: { kind: 'bernoulli-with-rate', rate: 0.5 },
    };
    const result = shouldProbeThisTurn(
      config,
      INITIAL_PROBE_SAMPLER_STATE,
      { rng: () => 0.1 },
    );
    expect(result.shouldProbe).toBe(true);
  });

  it('does not fire when the RNG draws above the rate', () => {
    const config: ProbeSamplerConfig = {
      strategy: { kind: 'bernoulli-with-rate', rate: 0.1 },
    };
    const result = shouldProbeThisTurn(
      config,
      INITIAL_PROBE_SAMPLER_STATE,
      { rng: () => 0.99 },
    );
    expect(result.shouldProbe).toBe(false);
  });

  it('clamps rate to [0,1]', () => {
    const cfgTooHigh: ProbeSamplerConfig = {
      strategy: { kind: 'bernoulli-with-rate', rate: 5 },
    };
    expect(
      shouldProbeThisTurn(cfgTooHigh, INITIAL_PROBE_SAMPLER_STATE, {
        rng: () => 0.99,
      }).shouldProbe,
    ).toBe(true);
    const cfgTooLow: ProbeSamplerConfig = {
      strategy: { kind: 'bernoulli-with-rate', rate: -1 },
    };
    expect(
      shouldProbeThisTurn(cfgTooLow, INITIAL_PROBE_SAMPLER_STATE, {
        rng: () => 0.01,
      }).shouldProbe,
    ).toBe(false);
  });
});

describe('escalation cooldown', () => {
  it('forces 100% sampling for the cooldown window after a trip', () => {
    const config: ProbeSamplerConfig = {
      strategy: { kind: 'every-n-turns', n: 100 },
      escalationCooldownTurns: 3,
    };
    let state: ProbeSamplerState = INITIAL_PROBE_SAMPLER_STATE;
    state = recordKillswitchTrip(config, state);
    expect(state.escalationTurnsRemaining).toBe(3);

    const fires: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      const result = shouldProbeThisTurn(config, state);
      fires.push(result.shouldProbe);
      state = result.nextState;
    }
    // First 3 turns: escalation forces fire. Then back to N=100 cadence.
    expect(fires).toEqual([true, true, true, false, false]);
  });

  it('preserves immutability of state across calls', () => {
    const config: ProbeSamplerConfig = {
      strategy: { kind: 'every-n-turns', n: 5 },
    };
    const state = INITIAL_PROBE_SAMPLER_STATE;
    const result = shouldProbeThisTurn(config, state);
    expect(state.turnsSeen).toBe(0);
    expect(result.nextState.turnsSeen).toBe(1);
    expect(Object.isFrozen(result.nextState)).toBe(true);
  });
});

describe('default configs', () => {
  it('defection (no judge): every 5 turns', () => {
    expect(DEFAULT_DEFECTION_SAMPLER_CONFIG.strategy.kind).toBe(
      'every-n-turns',
    );
    if (DEFAULT_DEFECTION_SAMPLER_CONFIG.strategy.kind === 'every-n-turns') {
      expect(DEFAULT_DEFECTION_SAMPLER_CONFIG.strategy.n).toBe(5);
    }
  });

  it('defection (with judge): every 10 turns', () => {
    if (
      DEFAULT_DEFECTION_WITH_JUDGE_SAMPLER_CONFIG.strategy.kind ===
      'every-n-turns'
    ) {
      expect(DEFAULT_DEFECTION_WITH_JUDGE_SAMPLER_CONFIG.strategy.n).toBe(10);
    }
  });

  it('alignment-faking: every 20 turns', () => {
    if (
      DEFAULT_ALIGNMENT_FAKING_SAMPLER_CONFIG.strategy.kind === 'every-n-turns'
    ) {
      expect(DEFAULT_ALIGNMENT_FAKING_SAMPLER_CONFIG.strategy.n).toBe(20);
    }
  });
});
