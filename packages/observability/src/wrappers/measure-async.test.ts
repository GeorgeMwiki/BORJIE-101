import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  measureAsync,
  measureDb,
  measureLlm,
  setMetricsSink,
  noopMetricsSink,
  type MetricsSink,
} from './measure-async';

function makeSpySink() {
  const sink: MetricsSink = {
    recordHistogram: vi.fn(),
    incrementCounter: vi.fn(),
  };
  return sink;
}

describe('measureAsync', () => {
  beforeEach(() => setMetricsSink(noopMetricsSink));

  it('records latency + success counter on ok', async () => {
    const sink = makeSpySink();
    setMetricsSink(sink);
    const result = await measureAsync('test', async () => 42);
    expect(result).toBe(42);
    expect(sink.recordHistogram).toHaveBeenCalledWith('test.latency_ms', expect.any(Number), {});
    expect(sink.incrementCounter).toHaveBeenCalledWith('test.success', {});
  });

  it('records error counter + rethrows on failure', async () => {
    const sink = makeSpySink();
    setMetricsSink(sink);
    await expect(measureAsync('test', async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');
    expect(sink.incrementCounter).toHaveBeenCalledWith('test.error', expect.objectContaining({ errorName: 'Error' }));
  });
});

describe('measureDb', () => {
  it('uses "db" namespace with operation label', async () => {
    const sink = makeSpySink();
    setMetricsSink(sink);
    await measureDb('select_property', async () => 'ok');
    expect(sink.recordHistogram).toHaveBeenCalledWith(
      'db.latency_ms',
      expect.any(Number),
      expect.objectContaining({ operation: 'select_property' })
    );
  });
});

describe('measureLlm', () => {
  it('records token histograms when usage is present', async () => {
    const sink = makeSpySink();
    setMetricsSink(sink);
    await measureLlm('claude-sonnet-4-6', async () => ({
      text: 'hi',
      usage: { input_tokens: 100, output_tokens: 50 },
    }));
    expect(sink.recordHistogram).toHaveBeenCalledWith(
      'llm.input_tokens',
      100,
      expect.objectContaining({ model: 'claude-sonnet-4-6' })
    );
    expect(sink.recordHistogram).toHaveBeenCalledWith(
      'llm.output_tokens',
      50,
      expect.objectContaining({ model: 'claude-sonnet-4-6' })
    );
  });
});
