/**
 * Three-agent debate + stakes-aware dispatcher — unit tests.
 *
 * Drives the proposer → critic → synthesizer pipeline with a
 * deterministic stub sensor that records every call. No network, no
 * clock dependence — tests run pure.
 *
 * Coverage (12 tests):
 *   1. Proposer call produces non-empty answer
 *   2. Critic call produces non-empty critique
 *   3. Synthesizer integrates both proposer + critic
 *   4. Token budget — exceeded budget skips the next stage but synthesis still surfaces
 *   5. Latency budget — exceeded budget skips next stage
 *   6. Convergence metric is bounded in [0, 1]
 *   7. Deterministic ordering — calls happen proposer → critic → synthesizer (no race)
 *   8. Stakes=low — dispatcher routes to single-agent (no three-agent)
 *   9. Stakes=high — dispatcher routes to three-agent
 *  10. Stakes=critical — dispatcher routes to three-agent
 *  11. Constitutional rules propagate to the critic's system + user prompts
 *  12. costSensitive=true at stakes=high — dispatcher falls back to single-agent
 *  13. Empty question → throws
 */

import { describe, it, expect } from 'vitest';
import {
  runThreeAgentDebate,
  runStakesAwareDebate,
  type ConstitutionRulePrompt,
  type SensorLike,
} from '../index.js';

// ─────────────────────────────────────────────────────────────────────
// Stub sensor — records every call's full args + emits a scripted reply.
// ─────────────────────────────────────────────────────────────────────

interface RecordedCall {
  readonly system: string;
  readonly userMessage: string;
  readonly stakes: string;
  readonly callIdx: number;
}

interface StubResult {
  readonly sensor: SensorLike;
  readonly calls: ReadonlyArray<RecordedCall>;
}

function makeStubSensor(
  scriptedReply: (call: RecordedCall) => string,
): StubResult {
  const calls: RecordedCall[] = [];
  const sensor: SensorLike = {
    async call(args) {
      const recorded: RecordedCall = {
        system: String(args.system ?? ''),
        userMessage: String(args.userMessage ?? ''),
        stakes: String(args.stakes ?? ''),
        callIdx: calls.length,
      };
      calls.push(recorded);
      return { text: scriptedReply(recorded) };
    },
  };
  return { sensor, calls };
}

const TZ_RENTAL_ACT: ConstitutionRulePrompt = {
  id: 'tz-rental-act-notice-period',
  description: 'TZ Rental Act: 14-day written notice required before eviction for non-payment.',
};

const KRA_TAX_FILING: ConstitutionRulePrompt = {
  id: 'kra-tax-filing',
  description:
    'KRA tax filing: rental income must be declared monthly; landlord remits 10% to KRA by the 20th of the following month.',
};

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('runThreeAgentDebate — pipeline', () => {
  it('Proposer produces a non-empty answer carried into the critic prompt', async () => {
    const { sensor, calls } = makeStubSensor((c) => {
      if (c.callIdx === 0) return 'Raise rent 8% effective next quarter; market supports it.';
      if (c.callIdx === 1) return 'Critic notes regulatory issue.';
      return 'Final synthesis with action.';
    });
    const result = await runThreeAgentDebate(
      'Should we raise rent 10%?',
      'occupancy 92%, market median +6%',
      sensor,
    );
    expect(result.proposal.length).toBeGreaterThan(0);
    expect(calls[1]!.userMessage).toContain(result.proposal);
  });

  it("Critic produces a non-empty critique carried into the synthesizer's prompt", async () => {
    const { sensor, calls } = makeStubSensor((c) => {
      if (c.callIdx === 0) return 'Proposer answer.';
      if (c.callIdx === 1) return 'Critic flags missing context on tenant churn risk.';
      return 'Synthesized final answer.';
    });
    const result = await runThreeAgentDebate(
      'Should we increase rent?',
      'context',
      sensor,
    );
    expect(result.criticism.length).toBeGreaterThan(0);
    // Synthesizer is the 3rd call (idx=2) and must include the critic's text.
    expect(calls[2]!.userMessage).toContain(result.criticism);
  });

  it('Synthesizer integrates both proposer + critic and emits the final answer', async () => {
    const { sensor } = makeStubSensor((c) => {
      if (c.callIdx === 0) return 'PROPOSER_TEXT';
      if (c.callIdx === 1) return 'CRITIC_TEXT';
      return 'SYNTH_TEXT mentions PROPOSER_TEXT and CRITIC_TEXT';
    });
    const result = await runThreeAgentDebate('Q?', 'C', sensor);
    expect(result.synthesis).toContain('SYNTH_TEXT');
    expect(result.synthesis).toBe('SYNTH_TEXT mentions PROPOSER_TEXT and CRITIC_TEXT');
  });

  it('Token budget — exceeded budget skips later stages; synthesis falls back to the proposal', async () => {
    const longReply = 'x'.repeat(20_000); // ~5000 tokens estimated
    const { sensor, calls } = makeStubSensor((c) => {
      if (c.callIdx === 0) return longReply; // proposal blows the budget
      return 'should not fire';
    });
    const result = await runThreeAgentDebate('Q?', 'C', sensor, {
      maxTokens: 4_000, // proposal call alone will spend > 5_000 estimated
    });
    // Critic + synthesizer should be skipped by the budget gate; the
    // synthesizer's fallback returns the proposal as the synthesis.
    expect(calls.length).toBe(1);
    expect(result.synthesis).toBe(longReply);
    expect(result.tokensUsed).toBeGreaterThan(0);
  });

  it('Latency budget — exceeded budget skips later stages', async () => {
    let now = 1000;
    const clock = () => now;
    const { sensor, calls } = makeStubSensor((c) => {
      // Each call costs 5_000 ms of wall-clock by jumping the fake clock.
      now += 5_000;
      return `reply-${c.callIdx}`;
    });
    const result = await runThreeAgentDebate('Q?', 'C', sensor, {
      maxLatencyMs: 6_000,
      clock,
    });
    // After proposer call wall-clock=5000 ≤ 6000 so critic call starts,
    // but its return puts the clock at 10000 — synthesizer is then
    // skipped because beforeSynth >= 6000.
    expect(calls.length).toBe(2);
    // Synthesis fell back to the proposal.
    expect(result.synthesis).toBe('reply-0');
    expect(result.latencyMs).toBeGreaterThanOrEqual(6_000);
  });

  it('Convergence metric is bounded in [0, 1]', async () => {
    const { sensor } = makeStubSensor((c) => `reply-${c.callIdx}`);
    const result = await runThreeAgentDebate('Q?', 'C', sensor);
    expect(result.convergence).toBeGreaterThanOrEqual(0);
    expect(result.convergence).toBeLessThanOrEqual(1);
  });

  it('Deterministic ordering — proposer fires first, critic second, synthesizer third', async () => {
    const fingerprint: string[] = [];
    const { sensor } = makeStubSensor((c) => {
      // Tag the call by the UNIQUE role-prefix in the system prompt so
      // ordering is observable. Critic + Synthesizer prompts both
      // reference "Proposer" in their instructions, so we must match
      // on the role-establishing phrase "You are the X".
      if (c.system.includes('You are the Proposer')) {
        fingerprint.push('P');
      } else if (c.system.includes('You are the Critic')) {
        fingerprint.push('C');
      } else if (c.system.includes('You are the Synthesizer')) {
        fingerprint.push('S');
      } else {
        fingerprint.push('?');
      }
      return `reply-${c.callIdx}`;
    });
    await runThreeAgentDebate('Q?', 'C', sensor);
    expect(fingerprint).toEqual(['P', 'C', 'S']);
  });

  it('Constitutional rules propagate to the critic — system + user prompts mention each rule id', async () => {
    const { sensor, calls } = makeStubSensor((c) => `reply-${c.callIdx}`);
    await runThreeAgentDebate('Q?', 'C', sensor, {
      constitutionalRules: [TZ_RENTAL_ACT, KRA_TAX_FILING],
    });
    // Critic is call idx=1.
    const criticCall = calls[1]!;
    expect(criticCall.system).toContain('tz-rental-act-notice-period');
    expect(criticCall.system).toContain('14-day');
    expect(criticCall.system).toContain('kra-tax-filing');
    expect(criticCall.system).toContain('KRA');
    // User prompt at minimum nudges the critic to cite the rule id.
    expect(criticCall.userMessage.toLowerCase()).toContain('constitution');
  });

  it('Empty question throws synchronously', async () => {
    const { sensor } = makeStubSensor(() => '');
    await expect(
      runThreeAgentDebate('   ', 'C', sensor),
    ).rejects.toThrow(/non-empty/);
  });
});

describe('runStakesAwareDebate — stakes gate', () => {
  it('stakes=low routes to single-agent (no three-agent calls)', async () => {
    const fingerprint: string[] = [];
    const { sensor, calls } = makeStubSensor((c) => {
      if (c.system.includes('You are the Proposer')) fingerprint.push('P');
      else if (c.system.includes('You are the Critic')) fingerprint.push('C');
      else if (c.system.includes('You are the Synthesizer')) fingerprint.push('S');
      else fingerprint.push('single');
      return 'single-agent reply';
    });
    const result = await runStakesAwareDebate('Q?', 'low', 'C', sensor);
    expect(result.mode).toBe('single-agent');
    expect(calls.length).toBe(1);
    expect(fingerprint).toEqual(['single']);
  });

  it('stakes=medium routes to single-agent', async () => {
    const { sensor, calls } = makeStubSensor(() => 'single-agent reply');
    const result = await runStakesAwareDebate('Q?', 'medium', 'C', sensor);
    expect(result.mode).toBe('single-agent');
    expect(calls.length).toBe(1);
    expect(result.synthesis).toBe('single-agent reply');
  });

  it('stakes=high invokes three-agent debate (3 sensor calls)', async () => {
    const fingerprint: string[] = [];
    const { sensor, calls } = makeStubSensor((c) => {
      if (c.system.includes('You are the Proposer')) fingerprint.push('P');
      else if (c.system.includes('You are the Critic')) fingerprint.push('C');
      else if (c.system.includes('You are the Synthesizer')) fingerprint.push('S');
      return `reply-${c.callIdx}`;
    });
    const result = await runStakesAwareDebate('Should we raise rent?', 'high', 'C', sensor);
    expect(result.mode).toBe('three-agent');
    expect(calls.length).toBe(3);
    expect(fingerprint).toEqual(['P', 'C', 'S']);
    expect(result.synthesis).toBe('reply-2');
    expect(result.proposal).toBe('reply-0');
    expect(result.criticism).toBe('reply-1');
  });

  it('stakes=critical invokes three-agent debate', async () => {
    const { sensor, calls } = makeStubSensor((c) => `reply-${c.callIdx}`);
    const result = await runStakesAwareDebate(
      'Should we evict for non-payment?',
      'critical',
      'tenant 60 days overdue',
      sensor,
    );
    expect(result.mode).toBe('three-agent');
    expect(calls.length).toBe(3);
    expect(result.synthesis).toBe('reply-2');
  });

  it('stakes=high + costSensitive=true bypasses the three-agent path', async () => {
    const { sensor, calls } = makeStubSensor(() => 'cost-pressured reply');
    const result = await runStakesAwareDebate('Q?', 'high', 'C', sensor, {
      costSensitive: true,
    });
    expect(result.mode).toBe('single-agent');
    expect(calls.length).toBe(1);
    expect(result.synthesis).toBe('cost-pressured reply');
  });

  it('three-agent dispatch surfaces convergence + token/latency budgets', async () => {
    let now = 0;
    const clock = () => {
      now += 100;
      return now;
    };
    const { sensor } = makeStubSensor((c) => `r${c.callIdx}`);
    const result = await runStakesAwareDebate(
      'Q?',
      'high',
      'C',
      sensor,
      { maxTokens: 8_000, maxLatencyMs: 10_000, clock },
    );
    expect(result.mode).toBe('three-agent');
    expect(typeof result.convergence).toBe('number');
    expect(result.tokensUsed).toBeGreaterThan(0);
    expect(result.latencyMs).toBeGreaterThan(0);
  });
});

describe('kernel.ts gate — conditional invocation', () => {
  // The gate snippet in kernel.ts is one line; this test simulates the
  // exact `if (stakes === 'high' || stakes === 'critical')` flow that
  // the kernel runs at the post-judge step, verifying the gate fires
  // only for the intended stakes set.
  it('only stakes ∈ {high, critical} cause the dispatcher to pick three-agent', async () => {
    const stakes: ReadonlyArray<'low' | 'medium' | 'high' | 'critical'> = [
      'low',
      'medium',
      'high',
      'critical',
    ];
    const observed: Array<{ s: string; mode: string }> = [];
    for (const s of stakes) {
      const { sensor } = makeStubSensor(() => 'r');
      const result = await runStakesAwareDebate('Q?', s, 'C', sensor);
      observed.push({ s, mode: result.mode });
    }
    expect(observed).toEqual([
      { s: 'low', mode: 'single-agent' },
      { s: 'medium', mode: 'single-agent' },
      { s: 'high', mode: 'three-agent' },
      { s: 'critical', mode: 'three-agent' },
    ]);
  });
});
