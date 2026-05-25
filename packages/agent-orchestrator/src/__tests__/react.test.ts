import { describe, expect, it } from 'vitest';
import { runReAct } from '../single-agent/react.js';
import { makeAgent, makeAddTool, makeEchoTool, makeFlakyTool, makeScriptedBrain } from './fixtures.js';

describe('runReAct', () => {
  it('terminates with end_turn when the model returns no tool calls', async () => {
    const { brain, callCount } = makeScriptedBrain({
      turns: [{ text: 'The answer is 42.', stopReason: 'end_turn' }],
    });
    const result = await runReAct({
      agent: makeAgent(),
      task: { id: 't', description: 'what is the answer?' },
      tools: [],
      brain,
    });
    expect(result.outcome).toBe('success');
    expect(result.answer).toBe('The answer is 42.');
    expect(callCount()).toBe(1);
    expect(result.brainCalls).toBe(1);
    expect(result.trace.some((e) => e.kind === 'final')).toBe(true);
  });

  it('executes a thought→action→observation→final loop with one tool call', async () => {
    const { brain } = makeScriptedBrain({
      turns: [
        {
          text: 'I need to add 2 and 3.',
          toolCalls: [{ id: 'c1', name: 'add', input: { a: 2, b: 3 } }],
          stopReason: 'tool_use',
        },
        { text: 'The sum is 5.', stopReason: 'end_turn' },
      ],
    });
    const result = await runReAct({
      agent: makeAgent(),
      task: { id: 't', description: 'sum 2 + 3' },
      tools: [makeAddTool()],
      brain,
    });
    expect(result.outcome).toBe('success');
    expect(result.answer).toBe('The sum is 5.');
    expect(result.brainCalls).toBe(2);
    const kinds = result.trace.map((e) => e.kind);
    expect(kinds).toContain('thought');
    expect(kinds).toContain('action');
    expect(kinds).toContain('observation');
    expect(kinds).toContain('final');
  });

  it('handles tool execution errors gracefully and feeds back to the model', async () => {
    const { brain } = makeScriptedBrain({
      turns: [
        {
          text: 'trying flaky tool',
          toolCalls: [{ id: 'c1', name: 'flaky', input: {} }],
          stopReason: 'tool_use',
        },
        { text: 'gave up', stopReason: 'end_turn' },
      ],
    });
    const result = await runReAct({
      agent: makeAgent({ toolAllowlist: ['flaky'] }),
      task: { id: 't', description: 'use flaky' },
      tools: [makeFlakyTool(5)],
      brain,
    });
    expect(result.outcome).toBe('success');
    expect(result.trace.some((e) => e.kind === 'observation' && e.detail.startsWith('error:'))).toBe(true);
  });

  it('respects maxSteps cap (no terminal answer => failed)', async () => {
    // Brain always wants to call a tool; never terminates.
    const { brain } = makeScriptedBrain({
      turns: Array(20).fill({
        text: 'looping',
        toolCalls: [{ id: 'c', name: 'echo', input: { value: 'x' } }],
        stopReason: 'tool_use' as const,
      }),
    });
    const result = await runReAct({
      agent: makeAgent({ toolAllowlist: ['echo'] }),
      task: { id: 't', description: 'loop forever' },
      tools: [makeEchoTool()],
      brain,
      maxSteps: 3,
    });
    expect(result.outcome).toBe('failed');
    expect(result.reason).toMatch(/maxSteps 3 exhausted/);
    expect(result.brainCalls).toBe(3);
  });

  it('reports unknown-tool error in the observation trace', async () => {
    const { brain } = makeScriptedBrain({
      turns: [
        {
          text: 'try unknown',
          toolCalls: [{ id: 'c', name: 'nonexistent', input: {} }],
          stopReason: 'tool_use',
        },
        { text: 'done', stopReason: 'end_turn' },
      ],
    });
    const result = await runReAct({
      agent: makeAgent({ toolAllowlist: ['nonexistent'] }),
      task: { id: 't', description: 'use missing' },
      tools: [],
      brain,
    });
    expect(result.outcome).toBe('success');
    expect(result.trace.some((e) => e.kind === 'observation' && /tool not found/.test(e.detail))).toBe(true);
  });

  it('returns budget-exhausted outcome when brain reports it', async () => {
    const { brain } = makeScriptedBrain({
      turns: [{ text: 'no can do', stopReason: 'budget_exceeded' }],
    });
    const result = await runReAct({
      agent: makeAgent(),
      task: { id: 't', description: 'x' },
      tools: [],
      brain,
    });
    expect(result.outcome).toBe('budget-exhausted');
  });

  it('only exposes allow-listed tools to the brain', async () => {
    const captured: string[] = [];
    const { brain } = makeScriptedBrain({
      turns: [{ text: 'done', stopReason: 'end_turn' }],
      onRequest: (req) => {
        for (const t of req.tools ?? []) captured.push(t.name);
      },
    });
    await runReAct({
      agent: makeAgent({ toolAllowlist: ['add'] }),
      task: { id: 't', description: 'x' },
      tools: [makeAddTool(), makeEchoTool()],
      brain,
    });
    expect(captured).toEqual(['add']);
  });
});
