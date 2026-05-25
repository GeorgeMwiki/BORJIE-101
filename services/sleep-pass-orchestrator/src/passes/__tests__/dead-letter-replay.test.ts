import { describe, expect, it } from 'vitest';
import {
  createDeadLetterReplayPass,
  createInMemoryDeadLetterAdapter,
} from '../index.js';

const now = () => new Date('2026-05-25T10:00:00.000Z');
const signal = new AbortController().signal;

describe('dead-letter-replay pass', () => {
  it('replays queued messages', async () => {
    const adapter = createInMemoryDeadLetterAdapter([
      { id: 'a', queue: 'q', payload: {}, enqueuedAt: '', attempts: 1 },
      { id: 'b', queue: 'q', payload: {}, enqueuedAt: '', attempts: 2 },
    ]);
    const pass = createDeadLetterReplayPass(adapter);
    const result = await pass.run({ abortSignal: signal, now });
    expect(result.itemsProcessed).toBe(2);
    expect(result.itemsEmitted).toBe(2);
    expect(adapter.dropped()).toEqual(['a', 'b']);
  });

  it('returns empty notes when nothing queued', async () => {
    const adapter = createInMemoryDeadLetterAdapter([]);
    const pass = createDeadLetterReplayPass(adapter);
    const result = await pass.run({ abortSignal: signal, now });
    expect(result.itemsProcessed).toBe(0);
    expect(result.itemsEmitted).toBe(0);
  });

  it('stops on abort signal mid-replay', async () => {
    const adapter = createInMemoryDeadLetterAdapter([
      { id: 'a', queue: 'q', payload: {}, enqueuedAt: '', attempts: 1 },
      { id: 'b', queue: 'q', payload: {}, enqueuedAt: '', attempts: 1 },
      { id: 'c', queue: 'q', payload: {}, enqueuedAt: '', attempts: 1 },
    ]);
    const ctrl = new AbortController();
    ctrl.abort();
    const pass = createDeadLetterReplayPass(adapter);
    const result = await pass.run({ abortSignal: ctrl.signal, now });
    expect(result.aborted).toBe(true);
    expect(result.itemsEmitted).toBeLessThan(3);
  });

  it('enforces batch ceiling', async () => {
    const seed = Array.from({ length: 50 }, (_, i) => ({
      id: `m${i}`,
      queue: 'q',
      payload: {},
      enqueuedAt: '',
      attempts: 1,
    }));
    const adapter = createInMemoryDeadLetterAdapter(seed);
    const pass = createDeadLetterReplayPass(adapter, 5);
    const result = await pass.run({ abortSignal: signal, now });
    expect(result.itemsProcessed).toBe(5);
  });
});
