/**
 * Idle-watchdog tests for `streamSse`.
 *
 * RESIDUAL-DOCTRINE (FAILURE ≠ EMPTINESS): a half-open socket leaves
 * `reader.read()` awaiting forever, so the chat spins with no error and
 * no completion. The watchdog must abort the stalled read and emit a
 * VISIBLE `stream_error` frame so the UI degrades to error/retry — never
 * an honest-empty silent end. These tests drive a controllable mock
 * reader to prove: (1) a stall surfaces `stream_error`, (2) a chunk
 * resets the idle timer (no false stall), (3) a rejected read surfaces
 * `stream_error`, (4) `idleTimeoutMs: 0` disables the watchdog.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  streamSse,
  STREAM_ERROR_EVENT,
  type SseEvent,
} from '../sse-stream';

/** A reader whose reads resolve only when the test releases them. */
function controllableReader() {
  const queue: Array<(r: ReadableStreamReadResult<Uint8Array>) => void> = [];
  const rejecters: Array<(e: unknown) => void> = [];
  let cancelled = false;
  return {
    cancelled: () => cancelled,
    reader: {
      read(): Promise<ReadableStreamReadResult<Uint8Array>> {
        return new Promise((resolve, reject) => {
          queue.push(resolve);
          rejecters.push(reject);
        });
      },
      cancel(): Promise<void> {
        cancelled = true;
        return Promise.resolve();
      },
      releaseLock() {},
    } as unknown as ReadableStreamDefaultReader<Uint8Array>,
    /** Resolve the oldest pending read with an encoded SSE block. */
    pushBlock(text: string) {
      const resolve = queue.shift();
      rejecters.shift();
      resolve?.({ value: new TextEncoder().encode(text), done: false });
    },
    /** Resolve the oldest pending read with done:true. */
    finish() {
      const resolve = queue.shift();
      rejecters.shift();
      resolve?.({ value: undefined, done: true });
    },
    /** Reject the oldest pending read (a transport error). */
    fail(err: unknown) {
      queue.shift();
      const reject = rejecters.shift();
      reject?.(err);
    },
  };
}

function mockFetchWithReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: { getReader: () => reader },
    } as unknown as Response),
  );
}

/** Drain the generator into an array, on a microtask-friendly schedule. */
async function collect(gen: AsyncGenerator<SseEvent>): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe('streamSse idle watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('emits a stream_error when no chunk arrives within the idle window', async () => {
    const ctrl = controllableReader();
    mockFetchWithReader(ctrl.reader);

    const events: SseEvent[] = [];
    const done = (async () => {
      for await (const ev of streamSse({
        path: '/api/v1/mining/chat',
        body: {},
        optimistic: { enabled: false },
        watchdog: { idleTimeoutMs: 5_000 },
      })) {
        events.push(ev);
      }
    })();

    // Let the fetch + first read register, then let the idle timer fire.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_000);
    await done;

    const errs = events.filter((e) => e.event === STREAM_ERROR_EVENT);
    expect(errs).toHaveLength(1);
    expect((errs[0]!.data as { reason: string }).reason).toBe('idle-timeout');
    // The half-open socket was released.
    expect(ctrl.cancelled()).toBe(true);
  });

  it('resets the idle timer on every chunk (no false stall)', async () => {
    const ctrl = controllableReader();
    mockFetchWithReader(ctrl.reader);

    const events: SseEvent[] = [];
    const done = (async () => {
      for await (const ev of streamSse({
        path: '/api/v1/mining/chat',
        body: {},
        optimistic: { enabled: false },
        watchdog: { idleTimeoutMs: 5_000 },
      })) {
        events.push(ev);
      }
    })();

    await vi.advanceTimersByTimeAsync(0);
    // A chunk lands at 4s (inside the window) → timer resets.
    await vi.advanceTimersByTimeAsync(4_000);
    ctrl.pushBlock('event: delta\ndata: {"text":"hi"}\n\n');
    // Another 4s passes (8s total, but only 4s since last chunk) → no stall.
    await vi.advanceTimersByTimeAsync(4_000);
    ctrl.finish();
    await done;

    expect(events.some((e) => e.event === STREAM_ERROR_EVENT)).toBe(false);
    expect(events.some((e) => e.event === 'delta')).toBe(true);
  });

  it('emits a stream_error when the read rejects (transport failure)', async () => {
    const ctrl = controllableReader();
    mockFetchWithReader(ctrl.reader);

    const events: SseEvent[] = [];
    const done = (async () => {
      for await (const ev of streamSse({
        path: '/api/v1/mining/chat',
        body: {},
        optimistic: { enabled: false },
        watchdog: { idleTimeoutMs: 5_000 },
      })) {
        events.push(ev);
      }
    })();

    await vi.advanceTimersByTimeAsync(0);
    ctrl.fail(new Error('socket reset'));
    await vi.advanceTimersByTimeAsync(0);
    await done;

    const errs = events.filter((e) => e.event === STREAM_ERROR_EVENT);
    expect(errs).toHaveLength(1);
    expect((errs[0]!.data as { reason: string }).reason).toBe('read-failed');
  });

  it('idleTimeoutMs:0 disables the watchdog (no spurious error)', async () => {
    const ctrl = controllableReader();
    mockFetchWithReader(ctrl.reader);

    const events: SseEvent[] = [];
    const done = (async () => {
      for await (const ev of streamSse({
        path: '/api/v1/mining/chat',
        body: {},
        optimistic: { enabled: false },
        watchdog: { idleTimeoutMs: 0 },
      })) {
        events.push(ev);
      }
    })();

    await vi.advanceTimersByTimeAsync(0);
    // Far past any default window — with the watchdog off, nothing fires.
    await vi.advanceTimersByTimeAsync(120_000);
    ctrl.pushBlock('event: delta\ndata: {"text":"ok"}\n\n');
    await vi.advanceTimersByTimeAsync(0);
    ctrl.finish();
    await done;

    expect(events.some((e) => e.event === STREAM_ERROR_EVENT)).toBe(false);
  });
});
