import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runParallelTools } from '../tool-calling/parallel-tools.js';
import { wrapToolForStrictSchema, StrictToolValidationError } from '../tool-calling/strict-schema.js';
import { retryWithDifferentTemperature } from '../tool-calling/retry-diversified.js';
import { makeAddTool, makeEchoTool, makeFlakyTool, makeScriptedBrain } from './fixtures.js';

describe('runParallelTools', () => {
  it('runs N tool calls in parallel and returns ordered results', async () => {
    const results = await runParallelTools({
      calls: [
        { id: 'c1', name: 'echo', input: { value: 'a' } },
        { id: 'c2', name: 'add', input: { a: 2, b: 3 } },
        { id: 'c3', name: 'echo', input: { value: 'c' } },
      ],
      tools: [makeEchoTool(), makeAddTool()],
      maxConcurrency: 4,
    });
    expect(results).toHaveLength(3);
    expect(results[0]?.ok).toBe(true);
    expect((results[0]?.output as { echoed: string }).echoed).toBe('a');
    expect((results[1]?.output as { sum: number }).sum).toBe(5);
    expect((results[2]?.output as { echoed: string }).echoed).toBe('c');
  });

  it('records errors per call without aborting the batch', async () => {
    const results = await runParallelTools({
      calls: [
        { id: 'c1', name: 'echo', input: { value: 'a' } },
        { id: 'c2', name: 'flaky', input: {} },
        { id: 'c3', name: 'echo', input: { value: 'c' } },
      ],
      tools: [makeEchoTool(), makeFlakyTool(99)],
    });
    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.ok).toBe(false);
    expect(results[1]?.error).toMatch(/flaky/);
    expect(results[2]?.ok).toBe(true);
  });

  it('reports tool-not-found per call', async () => {
    const results = await runParallelTools({
      calls: [{ id: 'c1', name: 'ghost', input: {} }],
      tools: [makeEchoTool()],
    });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.error).toMatch(/tool not found/);
  });
});

describe('wrapToolForStrictSchema', () => {
  it('rejects inputs that fail Zod validation', async () => {
    const tool = wrapToolForStrictSchema({
      tool: makeAddTool(),
      inputSchema: z.object({ a: z.number(), b: z.number() }),
    });
    await expect(tool.execute({ a: 'oops', b: 3 } as unknown as { a: number; b: number })).rejects.toThrow(
      StrictToolValidationError,
    );
  });

  it('allows correctly-typed inputs through', async () => {
    const tool = wrapToolForStrictSchema({
      tool: makeAddTool(),
      inputSchema: z.object({ a: z.number(), b: z.number() }),
    });
    const out = await tool.execute({ a: 2, b: 5 });
    expect((out as { sum: number }).sum).toBe(7);
  });

  it('validates outputs when output schema is provided', async () => {
    const tool = wrapToolForStrictSchema({
      tool: makeAddTool(),
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      outputSchema: z.object({ wrongField: z.number() }),
    });
    await expect(tool.execute({ a: 1, b: 1 })).rejects.toThrow(StrictToolValidationError);
  });
});

describe('retryWithDifferentTemperature', () => {
  it('stops at first success', async () => {
    const { brain } = makeScriptedBrain({
      turns: [
        { text: 'no tools', stopReason: 'end_turn' }, // fail
        { text: 'still no', stopReason: 'end_turn' }, // fail
        { text: 'final', stopReason: 'end_turn' },    // succeed
      ],
    });
    const out = await retryWithDifferentTemperature({
      call: { system: 's', messages: [] },
      brain,
      succeeded: (r) => r.text === 'final',
    });
    expect(out.success).toBe(true);
    expect(out.attempts).toBe(3);
    expect(out.winningTemperature).toBe(0.7);
  });

  it('returns success=false when all temperatures exhausted', async () => {
    const { brain } = makeScriptedBrain({
      turns: [
        { text: 'no', stopReason: 'end_turn' },
        { text: 'no', stopReason: 'end_turn' },
        { text: 'no', stopReason: 'end_turn' },
      ],
    });
    const out = await retryWithDifferentTemperature({
      call: { system: 's', messages: [] },
      brain,
      succeeded: () => false,
    });
    expect(out.success).toBe(false);
    expect(out.attempts).toBe(3);
  });
});
