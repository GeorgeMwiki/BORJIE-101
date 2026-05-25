/**
 * Internal debate + counterfactual reasoning — unit tests.
 *
 * Drives `runDebate` and the counterfactual builders/runner with a
 * deterministic stub Sensor that records every prompt + emits a
 * scripted reply. No network, no clock-dependence — tests run pure.
 *
 * Asserts:
 *   1. 4 voices × 2 rounds → 7 sensor calls (3 debaters × 2 rounds + 1 synthesis)
 *   2. token-budget exceeded mid-round → debate stops early, synthesis still runs
 *   3. convergence flag set when last two rounds' tokens are highly similar (jaccard ≥ 0.8)
 *   4. synthesiser receives ALL prior contributions in its prompt
 *   5. each non-synthesis voice receives ONLY OTHERS' prior contributions (not its own)
 *   6. `runCounterfactuals` calls sensor once per scenario
 *   7. `buildCounterfactuals('rent')` returns 3 scenarios with distinct perturbations
 *   8. empty voice list → throws
 *   9. unknown synthesiser id → throws
 */

import { describe, it, expect } from 'vitest';
import {
  runDebate,
  buildCounterfactuals,
  runCounterfactuals,
  DEFAULT_PROPERTY_DEBATE_VOICES,
  type DebateConfig,
  type DebateVoice,
} from '../kernel/debate/index.js';
import type {
  Sensor,
  SensorCallArgs,
  SensorCallResult,
} from '../kernel/index.js';

// ─────────────────────────────────────────────────────────────────────
// Stub sensor — records every call's full args + emits a scripted reply.
// ─────────────────────────────────────────────────────────────────────

interface RecordedCall {
  readonly system: string;
  readonly userMessage: string;
}

function makeStubSensor(
  scriptedReply: (call: RecordedCall, idx: number) => string,
): { sensor: Sensor; calls: ReadonlyArray<RecordedCall> } {
  const calls: RecordedCall[] = [];
  const sensor: Sensor = {
    id: 'stub',
    modelId: 'stub-model',
    priority: 0,
    capabilities: ['fast', 'thinking'],
    async call(args: SensorCallArgs): Promise<SensorCallResult> {
      const idx = calls.length;
      const recorded: RecordedCall = {
        system: args.system,
        userMessage: args.userMessage,
      };
      calls.push(recorded);
      return {
        text: scriptedReply(recorded, idx),
        thought: null,
        toolCalls: [],
        latencyMs: 1,
        modelId: 'stub-model',
        sensorId: 'stub',
      };
    },
  };
  return { sensor, calls };
}

const FOUR_VOICES = DEFAULT_PROPERTY_DEBATE_VOICES;

const STANDARD_CONFIG: DebateConfig = {
  voices: FOUR_VOICES,
  maxRounds: 2,
  synthesiserVoiceId: 'synthesiser',
  tokenBudget: 100_000,
};

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('runDebate — voice orchestration', () => {
  it('makes exactly 7 sensor calls for 4 voices × 2 rounds (3 debaters × 2 + 1 synthesis)', async () => {
    const { sensor, calls } = makeStubSensor(
      (_c, i) => `voice-${i}-reply`,
    );
    const outcome = await runDebate('Should we raise rent?', 'occupancy 92%', { sensor }, STANDARD_CONFIG);
    expect(calls.length).toBe(7);
    // 6 debate contributions + 1 synthesis = 7 total contributions.
    expect(outcome.contributions.length).toBe(7);
    // Synthesis text matches the last call's scripted reply.
    expect(outcome.synthesis).toBe('voice-6-reply');
  });

  it('stops the debate early when token budget is exhausted but still runs synthesis', async () => {
    // Tiny budget — the first few calls should consume it. Use long
    // replies to push the running total past the threshold quickly.
    const longReply = 'x'.repeat(2_000); // ~500 tokens estimated
    const { sensor, calls } = makeStubSensor(() => longReply);
    const tinyConfig: DebateConfig = {
      ...STANDARD_CONFIG,
      tokenBudget: 600, // ~ 1 voice call worth
    };
    const outcome = await runDebate(
      'How aggressive should retention be?',
      'context-here',
      { sensor },
      tinyConfig,
    );
    // Strictly fewer than the 7-call full debate.
    expect(calls.length).toBeLessThan(7);
    // Synthesis MUST still have run — last call is the synthesis.
    expect(outcome.synthesis).toBe(longReply);
    // The token-spent estimate exceeded the budget by the time we
    // bailed out, but synthesis still ran on whatever contributions
    // had accumulated.
    expect(outcome.tokenSpent).toBeGreaterThan(0);
  });

  it('marks converged=true when each debater repeats near-identical text across rounds', async () => {
    // Same reply every call for a given voice → jaccard = 1.
    const { sensor } = makeStubSensor((c) => {
      if (c.userMessage.includes('Owner Advocate')) {
        return 'rent stable yield protected risk acceptable';
      }
      if (c.userMessage.includes('Tenant Advocate')) {
        return 'habitability fairness regulatory rights matter';
      }
      if (c.userMessage.includes("Devil's Advocate")) {
        return 'missing data edge cases regulatory pitfalls';
      }
      return 'synthesis recommended action';
    });
    const outcome = await runDebate(
      'Should we raise rent?',
      'occ 92%',
      { sensor },
      STANDARD_CONFIG,
    );
    expect(outcome.converged).toBe(true);
  });

  it('marks converged=false when each debater says completely different things across rounds', async () => {
    let callCount = 0;
    const { sensor } = makeStubSensor(() => {
      callCount++;
      // Wildly different vocabularies per call → jaccard ≈ 0.
      const vocabs = [
        'apple banana carrot daikon eggplant',
        'xerox yacht zebra alpha bravo',
        'pi rho sigma tau upsilon',
        'mercury venus mars jupiter saturn',
        'nitrogen oxygen carbon hydrogen helium',
        'tundra savanna desert taiga rainforest',
        'synth red green blue',
      ];
      return vocabs[callCount - 1] ?? 'fallback';
    });
    const outcome = await runDebate(
      'Q?',
      'C',
      { sensor },
      STANDARD_CONFIG,
    );
    expect(outcome.converged).toBe(false);
  });

  it("synthesiser receives ALL prior contributions in its user-prompt", async () => {
    let counter = 0;
    const { sensor, calls } = makeStubSensor(() => {
      counter++;
      return `R${counter}`;
    });
    await runDebate('Q?', 'C', { sensor }, STANDARD_CONFIG);
    const synthesisCall = calls[calls.length - 1]!;
    // Synthesis prompt should mention every debater's contribution by id.
    expect(synthesisCall.userMessage).toContain('[advocate r1]');
    expect(synthesisCall.userMessage).toContain('[advocate r2]');
    expect(synthesisCall.userMessage).toContain('[critic r1]');
    expect(synthesisCall.userMessage).toContain('[critic r2]');
    expect(synthesisCall.userMessage).toContain('[devils-advocate r1]');
    expect(synthesisCall.userMessage).toContain('[devils-advocate r2]');
  });

  it('each non-synthesis voice sees ONLY OTHERS prior contributions, never its own', async () => {
    let counter = 0;
    const { sensor, calls } = makeStubSensor(() => {
      counter++;
      return `R${counter}`;
    });
    await runDebate('Q?', 'C', { sensor }, STANDARD_CONFIG);

    // Round-2 advocate call (4th call: round-1 has 3 voices, then round-2 advocate).
    const round2AdvocateCall = calls[3]!;
    // It should reference the OTHER voices' round-1 contributions but
    // NOT its own.
    expect(round2AdvocateCall.userMessage).toContain('[critic r1]');
    expect(round2AdvocateCall.userMessage).toContain('[devils-advocate r1]');
    expect(round2AdvocateCall.userMessage).not.toContain('[advocate r1]');
  });

  it('throws when voices array is empty', async () => {
    const { sensor } = makeStubSensor(() => '');
    await expect(
      runDebate('Q?', 'C', { sensor }, {
        voices: [],
        maxRounds: 2,
        synthesiserVoiceId: 'synthesiser',
      }),
    ).rejects.toThrow(/voices array must not be empty/);
  });

  it('throws when synthesiser id is not in voices', async () => {
    const { sensor } = makeStubSensor(() => '');
    const debaterOnly: DebateVoice[] = [FOUR_VOICES[0]!];
    await expect(
      runDebate('Q?', 'C', { sensor }, {
        voices: debaterOnly,
        maxRounds: 1,
        synthesiserVoiceId: 'no-such-id',
      }),
    ).rejects.toThrow(/synthesiserVoiceId/);
  });
});

describe('counterfactuals', () => {
  it("buildCounterfactuals('rent') returns 3 distinct scenarios", () => {
    const out = buildCounterfactuals('Should we raise rent?', 'rent');
    expect(out.length).toBe(3);
    const ids = out.map((s) => s.id);
    expect(new Set(ids).size).toBe(3);
    const perturbations = out.map((s) => s.perturbation);
    expect(new Set(perturbations).size).toBe(3);
    // Every scenario carries the original question verbatim.
    for (const sc of out) {
      expect(sc.question).toBe('Should we raise rent?');
    }
  });

  it('runCounterfactuals calls sensor exactly once per scenario', async () => {
    const { sensor, calls } = makeStubSensor((_c, i) => `cf-reply-${i}`);
    const scenarios = buildCounterfactuals('How would NOI shift?', 'vacancy');
    const outcomes = await runCounterfactuals(scenarios, 'occupancy 88%', { sensor });
    expect(calls.length).toBe(scenarios.length);
    expect(outcomes.length).toBe(scenarios.length);
    expect(outcomes[0]?.scenarioId).toBe(scenarios[0]?.id);
  });
});
