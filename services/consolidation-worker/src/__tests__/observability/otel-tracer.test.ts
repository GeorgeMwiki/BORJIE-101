/**
 * OTel tracer wiring — unit tests.
 *
 * Coverage:
 *   1. createNoopTracer runs the callback transparently
 *   2. createStageTracer falls back to no-op when @opentelemetry/api
 *      is not resolvable (since the worker doesn't depend on it)
 *   3. no-op runner returns the underlying value
 *   4. no-op runner propagates exceptions
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createNoopTracer,
  createStageTracer,
} from '../../observability/otel-tracer.js';

describe('otel-tracer', () => {
  it('createNoopTracer runs the callback transparently', async () => {
    const tracer = createNoopTracer();
    const out = await tracer.startTick('t1', async (runStage) => {
      const a = await runStage('01-ingest', async () => 'a');
      const b = await runStage('02-cluster', async () => 'b');
      return [a, b].join('-');
    });
    expect(out).toBe('a-b');
  });

  it('createStageTracer falls back to no-op when otel api absent', async () => {
    const tracer = await createStageTracer({ forceDisabled: true });
    const calls: string[] = [];
    await tracer.startTick('t2', async (runStage) => {
      await runStage('01-ingest', async () => {
        calls.push('01');
      });
    });
    expect(calls).toEqual(['01']);
  });

  it('runStage propagates the return value', async () => {
    const tracer = createNoopTracer();
    const result = await tracer.startTick('t3', async (runStage) =>
      runStage('00', async () => ({ ok: true, n: 42 })),
    );
    expect(result.n).toBe(42);
  });

  it('runStage propagates thrown errors', async () => {
    const tracer = createNoopTracer();
    const fn = vi.fn(async () => {
      throw new Error('stage boom');
    });
    await expect(
      tracer.startTick('t4', async (runStage) => runStage('05-decay', fn)),
    ).rejects.toThrow('stage boom');
    expect(fn).toHaveBeenCalledOnce();
  });
});
