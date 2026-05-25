import { describe, expect, it } from 'vitest';
import {
  createInMemoryDurableStore,
  listCheckpoints,
  replayFromCheckpoint,
  wrapAsDurable,
} from '../durable-execution/durable.js';

describe('wrapAsDurable', () => {
  it('checkpoints each step and resolves with the runner result', async () => {
    const store = createInMemoryDurableStore<{ count: number }>();
    const handle = wrapAsDurable<{ count: number }, string>({
      store,
      runner: async ({ checkpoint }) => {
        await checkpoint({ count: 1 });
        await checkpoint({ count: 2 });
        await checkpoint({ count: 3 }, { terminal: true });
        return 'done';
      },
    });
    const result = await handle.promise;
    expect(result).toBe('done');
    const list = await listCheckpoints(handle.runId, store);
    expect(list).toHaveLength(3);
    expect(list.at(-1)?.terminal).toBe(true);
    expect(list.at(-1)?.partial.count).toBe(3);
  });

  it('latest returns the most recent checkpoint', async () => {
    const store = createInMemoryDurableStore<{ note: string }>();
    const handle = wrapAsDurable<{ note: string }, void>({
      store,
      runner: async ({ checkpoint }) => {
        await checkpoint({ note: 'a' });
        await checkpoint({ note: 'b' });
      },
    });
    await handle.promise;
    const latest = await replayFromCheckpoint(handle.runId, store);
    expect(latest?.partial.note).toBe('b');
  });

  it('routes saves through Inngest-like port when supplied', async () => {
    const store = createInMemoryDurableStore<{ x: number }>();
    const calls: string[] = [];
    const inngest = {
      async step<T>(id: string, fn: () => Promise<T>): Promise<T> {
        calls.push(id);
        return fn();
      },
    };
    const handle = wrapAsDurable<{ x: number }, void>({
      store,
      inngest,
      runner: async ({ checkpoint }) => {
        await checkpoint({ x: 1 });
        await checkpoint({ x: 2 });
      },
    });
    await handle.promise;
    expect(calls).toEqual(['save-1', 'save-2']);
  });

  it('runId is stable when caller supplies it', async () => {
    const store = createInMemoryDurableStore<{ y: number }>();
    const handle = wrapAsDurable<{ y: number }, void>({
      store,
      runId: 'fixed',
      runner: async ({ checkpoint }) => {
        await checkpoint({ y: 1 });
      },
    });
    await handle.promise;
    expect(handle.runId).toBe('fixed');
    const list = await listCheckpoints('fixed', store);
    expect(list).toHaveLength(1);
  });
});
