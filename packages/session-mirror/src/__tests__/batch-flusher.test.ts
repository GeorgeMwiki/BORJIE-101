/**
 * batch-flusher tests — accumulation + size-triggered flush +
 * interval-triggered flush + error containment.
 */

import { describe, expect, it, vi } from 'vitest';
import { BatchFlusher } from '../provider/batch-flusher.js';
import type { CaptureEvent } from '../types.js';

function makeEvent(i: number): CaptureEvent {
  return {
    kind: 'field_change',
    emittedAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
    sessionId: 'sess_1',
    tabId: 'tab_1',
    fieldId: `field_${i}`,
    value: {
      tabId: 'tab_1',
      fieldId: `field_${i}`,
      capturedAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
      valuePlaintext: `v${i}`,
      piiKind: 'none',
    },
  };
}

describe('BatchFlusher', () => {
  it('flushes immediately when maxBatchSize is reached', async () => {
    const flushed: ReadonlyArray<CaptureEvent>[] = [];
    const f = new BatchFlusher({
      maxBatchSize: 2,
      flushIntervalMs: 100_000,
      onFlush: async (events) => {
        flushed.push(events);
      },
    });
    f.enqueue(makeEvent(1));
    f.enqueue(makeEvent(2));
    // Wait a tick for the async onFlush to settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(flushed.length).toBe(1);
    expect(flushed[0]?.length).toBe(2);
    f.stop();
  });

  it('flushes on the interval timer when the buffer is below max', async () => {
    vi.useFakeTimers();
    const flushed: ReadonlyArray<CaptureEvent>[] = [];
    const f = new BatchFlusher({
      maxBatchSize: 50,
      flushIntervalMs: 500,
      onFlush: async (events) => {
        flushed.push(events);
      },
    });
    f.enqueue(makeEvent(1));
    expect(f.__peek().length).toBe(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(flushed.length).toBe(1);
    expect(flushed[0]?.length).toBe(1);
    expect(f.__peek().length).toBe(0);
    f.stop();
    vi.useRealTimers();
  });

  it('swallows errors from onFlush', async () => {
    const f = new BatchFlusher({
      maxBatchSize: 1,
      flushIntervalMs: 100_000,
      onFlush: async () => {
        throw new Error('network down');
      },
    });
    f.enqueue(makeEvent(1));
    // Should not throw; control returns and the queue is drained.
    await Promise.resolve();
    await Promise.resolve();
    expect(f.__peek().length).toBe(0);
    f.stop();
  });

  it('refuses enqueues after stop()', () => {
    const f = new BatchFlusher({
      maxBatchSize: 1,
      flushIntervalMs: 100,
      onFlush: async () => undefined,
    });
    f.stop();
    f.enqueue(makeEvent(1));
    expect(f.__peek().length).toBe(0);
  });
});
