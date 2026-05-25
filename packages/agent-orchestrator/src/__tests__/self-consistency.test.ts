import { describe, expect, it } from 'vitest';
import { runSelfConsistency } from '../single-agent/self-consistency.js';
import { makeAgent, makeScriptedBrain } from './fixtures.js';

describe('runSelfConsistency', () => {
  it('returns the majority answer among N samples', async () => {
    // 3 samples: "yes", "yes", "no" -> majority "yes"
    const { brain } = makeScriptedBrain({
      turns: [
        { text: 'yes', stopReason: 'end_turn' },
        { text: 'yes', stopReason: 'end_turn' },
        { text: 'no', stopReason: 'end_turn' },
      ],
    });
    const result = await runSelfConsistency({
      agent: makeAgent(),
      task: { id: 't', description: 'is this true?' },
      brain,
      n: 3,
    });
    expect(result.outcome).toBe('success');
    expect(result.answer.toLowerCase()).toBe('yes');
    expect(result.brainCalls).toBe(3);
    expect(result.reason).toBe('majority 2/3');
    // 3 vote entries + 1 final + thoughts
    const voteCount = result.trace.filter((e) => e.kind === 'vote').length;
    expect(voteCount).toBe(2); // two distinct canonical answers
  });

  it('canonicalises answers when caller supplies a normalizer', async () => {
    const { brain } = makeScriptedBrain({
      turns: [
        { text: 'The answer is 42!', stopReason: 'end_turn' },
        { text: '42', stopReason: 'end_turn' },
        { text: 'forty-two', stopReason: 'end_turn' },
      ],
    });
    const result = await runSelfConsistency({
      agent: makeAgent(),
      task: { id: 't', description: 'x' },
      brain,
      n: 3,
      canonicalise: (t) => {
        const m = /(\d+)/.exec(t);
        return m && m[1] ? m[1] : t.trim().toLowerCase();
      },
    });
    expect(result.answer).toMatch(/42/);
  });

  it('handles n=1 (single sample, no real voting)', async () => {
    const { brain } = makeScriptedBrain({
      turns: [{ text: 'lonely', stopReason: 'end_turn' }],
    });
    const result = await runSelfConsistency({
      agent: makeAgent(),
      task: { id: 't', description: 'x' },
      brain,
      n: 1,
    });
    expect(result.brainCalls).toBe(1);
    expect(result.answer).toBe('lonely');
  });

  it('rejects n < 1', async () => {
    const { brain } = makeScriptedBrain({ turns: [{ text: 'x', stopReason: 'end_turn' }] });
    await expect(
      runSelfConsistency({
        agent: makeAgent(),
        task: { id: 't', description: 'x' },
        brain,
        n: 0,
      }),
    ).rejects.toThrow(/n must be >= 1/);
  });

  it('uses default n=5 when unspecified', async () => {
    const { brain, callCount } = makeScriptedBrain({
      turns: Array(5).fill({ text: 'a', stopReason: 'end_turn' as const }),
    });
    await runSelfConsistency({
      agent: makeAgent(),
      task: { id: 't', description: 'x' },
      brain,
    });
    expect(callCount()).toBe(5);
  });
});
