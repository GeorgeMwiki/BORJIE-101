import { describe, expect, it } from 'vitest';
import { createBatchExecutor } from '../cost-optimization/batch-executor.js';
import { makeScriptedBrain } from './fixtures.js';
import type { BrainCallResponse } from '../types.js';

describe('createBatchExecutor', () => {
  it('uses batchBrain when supplied and groups requests', async () => {
    const { brain } = makeScriptedBrain({ turns: [{ text: 'fallback', stopReason: 'end_turn' }] });
    const captured: number[] = [];
    const batchBrain = {
      async callBatch(reqs: ReadonlyArray<unknown>): Promise<ReadonlyArray<BrainCallResponse>> {
        captured.push(reqs.length);
        return reqs.map((_, i) => ({
          text: `batched-${i}`,
          toolCalls: [],
          usage: { inputTokens: 10, outputTokens: 5 },
          model: 'batch',
          stopReason: 'end_turn' as const,
        }));
      },
    };
    const exec = createBatchExecutor({ brain, batchBrain, windowMs: 0, maxBatchSize: 3 });
    const p1 = exec.brain.call({ system: '', messages: [] });
    const p2 = exec.brain.call({ system: '', messages: [] });
    const p3 = exec.brain.call({ system: '', messages: [] });
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1.text).toBe('batched-0');
    expect(r2.text).toBe('batched-1');
    expect(r3.text).toBe('batched-2');
    expect(captured).toEqual([3]);
    expect(exec.stats().batches).toBe(1);
  });

  it('falls back to serial when no batchBrain is supplied', async () => {
    const { brain } = makeScriptedBrain({
      turns: [
        { text: 'a', stopReason: 'end_turn' },
        { text: 'b', stopReason: 'end_turn' },
      ],
    });
    const exec = createBatchExecutor({ brain, windowMs: 0, maxBatchSize: 2 });
    const [a, b] = await Promise.all([
      exec.brain.call({ system: '', messages: [] }),
      exec.brain.call({ system: '', messages: [] }),
    ]);
    expect(a.text).toBe('a');
    expect(b.text).toBe('b');
    expect(exec.stats().serial).toBe(2);
  });

  it('manual flush dispatches pending requests', async () => {
    let scheduled: (() => void) | null = null;
    const captured: number[] = [];
    const { brain } = makeScriptedBrain({ turns: [{ text: 'x', stopReason: 'end_turn' }] });
    const batchBrain = {
      async callBatch(reqs: ReadonlyArray<unknown>): Promise<ReadonlyArray<BrainCallResponse>> {
        captured.push(reqs.length);
        return reqs.map(() => ({
          text: 'ok',
          toolCalls: [],
          usage: { inputTokens: 0, outputTokens: 0 },
          model: 'b',
          stopReason: 'end_turn' as const,
        }));
      },
    };
    const exec = createBatchExecutor({
      brain,
      batchBrain,
      windowMs: 1000,
      maxBatchSize: 100,
      schedule: (cb) => { scheduled = cb; return null; },
    });
    const p = exec.brain.call({ system: '', messages: [] });
    expect(scheduled).not.toBeNull();
    expect(captured.length).toBe(0); // not yet flushed
    await exec.flush();
    await p;
    expect(captured).toEqual([1]);
  });
});
