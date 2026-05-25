import { describe, expect, it } from 'vitest';
import { subscribeToWidget, type RealtimePort } from '../streaming/index.js';
import type { ParsedRow } from '../types.js';

function createFakePort(): {
  readonly port: RealtimePort;
  push(rows: readonly ParsedRow[]): void;
} {
  let handler: ((rows: readonly ParsedRow[]) => void) | null = null;
  return {
    port: {
      subscribe(_channel, h) {
        handler = h;
        return {
          unsubscribe() {
            handler = null;
          },
        };
      },
    },
    push(rows) {
      handler?.(rows);
    },
  };
}

async function takeOne(it: AsyncIterable<unknown>): Promise<unknown> {
  for await (const v of it) {
    return v;
  }
  return undefined;
}

describe('streaming / subscribeToWidget', () => {
  it('emits a DataDelta when realtime push arrives', async () => {
    const fake = createFakePort();
    const iter = subscribeToWidget({ widgetId: 'w1', channel: 't.x', realtime: fake.port, throttleMs: 0 });
    setTimeout(() => fake.push([{ a: 1 }]), 5);
    const v = (await takeOne(iter)) as { widgetId: string; rows: readonly ParsedRow[] };
    expect(v.widgetId).toBe('w1');
    expect(v.rows).toEqual([{ a: 1 }]);
  });

  it('coalesces multiple pushes when waiting for throttle window', async () => {
    const fake = createFakePort();
    const iter = subscribeToWidget({
      widgetId: 'w1',
      channel: 't.x',
      realtime: fake.port,
      throttleMs: 50,
    });
    // Push three batches quickly — only the last should be emitted.
    setTimeout(() => fake.push([{ a: 1 }]), 5);
    setTimeout(() => fake.push([{ a: 2 }]), 10);
    setTimeout(() => fake.push([{ a: 3 }]), 15);
    const v = (await takeOne(iter)) as { rows: readonly ParsedRow[] };
    expect(v.rows).toEqual([{ a: 3 }]);
  });

  it('abort signal terminates the iterable', async () => {
    const fake = createFakePort();
    const ctrl = new AbortController();
    const iter = subscribeToWidget({
      widgetId: 'w1',
      channel: 't.x',
      realtime: fake.port,
      throttleMs: 0,
      signal: ctrl.signal,
    });
    const promise = takeOne(iter);
    ctrl.abort();
    const v = await promise;
    expect(v).toBeUndefined();
  });
});
