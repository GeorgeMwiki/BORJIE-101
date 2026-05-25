import { describe, expect, it } from 'vitest';
import { wrapWithBudget } from '../cost-optimization/budget.js';
import { BudgetExceededError } from '../types.js';
import { makeScriptedBrain } from './fixtures.js';

describe('wrapWithBudget', () => {
  it('enforces per-call cap before issuing the call', async () => {
    const { brain } = makeScriptedBrain({ turns: [{ text: 'x', stopReason: 'end_turn' }] });
    const wrapped = wrapWithBudget({ brain, budget: { perCall: 100, perSession: 1_000_000 } });
    await expect(
      wrapped.brain.call({ system: '', messages: [], maxTokens: 500 }),
    ).rejects.toThrow(BudgetExceededError);
    expect(wrapped.state().brainCalls).toBe(0);
  });

  it('enforces per-session cap when usage accumulates', async () => {
    const { brain } = makeScriptedBrain({
      turns: [
        { text: 'a', inputTokens: 300, outputTokens: 300, stopReason: 'end_turn' },
        { text: 'b', inputTokens: 300, outputTokens: 300, stopReason: 'end_turn' },
      ],
    });
    const wrapped = wrapWithBudget({ brain, budget: { perCall: 1_000, perSession: 1_000 } });
    await wrapped.brain.call({ system: '', messages: [] }); // 600 used
    await expect(
      wrapped.brain.call({ system: '', messages: [] }), // would push to 1200
    ).rejects.toThrow(BudgetExceededError);
    expect(wrapped.state().brainCalls).toBe(2);
  });

  it('enforces maxBrainCalls cap', async () => {
    const { brain } = makeScriptedBrain({
      turns: Array(5).fill({ text: 'x', stopReason: 'end_turn' as const }),
    });
    const wrapped = wrapWithBudget({ brain, budget: { perCall: 100_000, perSession: 100_000, maxBrainCalls: 2 } });
    await wrapped.brain.call({ system: '', messages: [] });
    await wrapped.brain.call({ system: '', messages: [] });
    await expect(wrapped.brain.call({ system: '', messages: [] })).rejects.toThrow(BudgetExceededError);
  });

  it('enforces maxWallMs cap via injected clock', async () => {
    const { brain } = makeScriptedBrain({ turns: [{ text: 'x', stopReason: 'end_turn' }] });
    let t = 0;
    const wrapped = wrapWithBudget({
      brain,
      budget: { perCall: 100_000, perSession: 100_000, maxWallMs: 10 },
      clock: () => t,
    });
    await wrapped.brain.call({ system: '', messages: [] });
    t = 100;
    await expect(wrapped.brain.call({ system: '', messages: [] })).rejects.toThrow(/wall-ms/);
  });

  it('reset clears session usage', async () => {
    const { brain } = makeScriptedBrain({
      turns: [{ text: 'x', inputTokens: 500, outputTokens: 500, stopReason: 'end_turn' }],
    });
    const wrapped = wrapWithBudget({ brain, budget: { perCall: 100_000, perSession: 100_000 } });
    await wrapped.brain.call({ system: '', messages: [] });
    expect(wrapped.state().sessionTokens).toBe(1000);
    wrapped.reset();
    expect(wrapped.state().sessionTokens).toBe(0);
  });
});
