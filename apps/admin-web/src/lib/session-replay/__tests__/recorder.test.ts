/**
 * recorder — unit tests.
 *
 * Exercises the recorder's contract without depending on rrweb being
 * installed: a synthetic `rrwebFactory` is injected so every `emit()`
 * is captured deterministically.
 *
 *   1. start → emits events into the buffer → forceFlush hands one
 *      chunk to the uploader
 *   2. flush cadence: events buffered until interval fires
 *   3. sequence number monotonically increments per chunk
 *   4. PII patterns in event JSON scrubbed before reaching the uploader
 *   5. stop() drains remaining buffer and calls uploader.flushOnUnload
 *   6. recorder is inert when no rrwebFactory + no rrweb installed
 *      (factory returns null)
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import {
  startSessionReplayRecorder,
  type RrwebEvent,
  type RrwebRecordFactory,
} from '../recorder';
import type {
  ChunkUploader,
  SessionReplayChunk,
} from '../chunk-uploader';

function fakeUploader(): ChunkUploader & {
  readonly chunks: SessionReplayChunk[];
} {
  const chunks: SessionReplayChunk[] = [];
  const u = {
    chunks,
    enqueue: vi.fn((c: SessionReplayChunk) => {
      chunks.push(c);
    }),
    flush: vi.fn(async () => {
      /* no-op */
    }),
    flushOnUnload: vi.fn(() => true),
    getStats: () => ({
      bufferedChunks: 0,
      bufferedBytes: 0,
      droppedChunks: 0,
      failedFlushAttempts: 0,
      successfulUploads: chunks.length,
    }),
  };
  return u as unknown as ChunkUploader & { readonly chunks: SessionReplayChunk[] };
}

function makeFactory(): {
  factory: RrwebRecordFactory;
  emit: (e: RrwebEvent) => void;
  stop: ReturnType<typeof vi.fn>;
} {
  const stop = vi.fn();
  let captured: ((e: RrwebEvent) => void) | null = null;
  const factory: RrwebRecordFactory = (opts) => {
    captured = opts.emit;
    return stop;
  };
  return {
    factory,
    emit: (e) => captured?.(e),
    stop,
  };
}

describe('startSessionReplayRecorder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('forceFlush hands one chunk to the uploader with the buffered events', async () => {
    const uploader = fakeUploader();
    const fac = makeFactory();
    const handle = await startSessionReplayRecorder({
      sessionId: 'sess-1',
      uploader,
      rrwebFactory: fac.factory,
    });
    fac.emit({ type: 2, timestamp: 1, data: { x: 1 } });
    fac.emit({ type: 3, timestamp: 2, data: { x: 2 } });
    const n = handle.forceFlush();
    expect(n).toBe(1);
    expect(uploader.chunks).toHaveLength(1);
    expect(uploader.chunks[0]?.eventCount).toBe(2);
    expect(uploader.chunks[0]?.sequenceNumber).toBe(0);
    await handle.stop();
  });

  it('interval flush eventually hands events to the uploader', async () => {
    const uploader = fakeUploader();
    const fac = makeFactory();
    const handle = await startSessionReplayRecorder({
      sessionId: 'sess-1',
      uploader,
      rrwebFactory: fac.factory,
      flushIntervalMs: 30_000,
    });
    fac.emit({ type: 2, timestamp: 1 });
    expect(uploader.chunks).toHaveLength(0);
    vi.advanceTimersByTime(30_000);
    expect(uploader.chunks).toHaveLength(1);
    await handle.stop();
  });

  it('sequence numbers increment monotonically per chunk', async () => {
    const uploader = fakeUploader();
    const fac = makeFactory();
    const handle = await startSessionReplayRecorder({
      sessionId: 'sess-1',
      uploader,
      rrwebFactory: fac.factory,
    });
    fac.emit({ type: 2, timestamp: 1 });
    handle.forceFlush();
    fac.emit({ type: 3, timestamp: 2 });
    handle.forceFlush();
    fac.emit({ type: 4, timestamp: 3 });
    handle.forceFlush();
    expect(uploader.chunks.map((c) => c.sequenceNumber)).toEqual([0, 1, 2]);
    await handle.stop();
  });

  it('scrubs PII patterns from events before passing to the uploader', async () => {
    const uploader = fakeUploader();
    const fac = makeFactory();
    const handle = await startSessionReplayRecorder({
      sessionId: 'sess-1',
      uploader,
      rrwebFactory: fac.factory,
    });
    fac.emit({
      type: 5,
      timestamp: 100,
      data: { text: 'PIN A123456789B and card 4242 4242 4242 4242' },
    });
    handle.forceFlush();
    const payload = uploader.chunks[0]?.eventsJson ?? '';
    expect(payload).not.toContain('A123456789B');
    expect(payload).not.toContain('4242 4242 4242 4242');
    expect(payload).toContain('•');
    await handle.stop();
  });

  it('stop() drains remaining events + signals uploader unload path', async () => {
    const uploader = fakeUploader();
    const fac = makeFactory();
    const handle = await startSessionReplayRecorder({
      sessionId: 'sess-1',
      uploader,
      rrwebFactory: fac.factory,
    });
    fac.emit({ type: 2, timestamp: 1 });
    await handle.stop();
    expect(uploader.chunks).toHaveLength(1);
    expect(fac.stop).toHaveBeenCalledOnce();
    // After stop we expect at least one explicit flush() call from the
    // forceFlush path (other flushes happen on visibilitychange too).
    expect((uploader.flush as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it('inert handle when no factory and rrweb missing', async () => {
    const uploader = fakeUploader();
    // No factory provided + dynamic import of 'rrweb' fails in jsdom.
    const handle = await startSessionReplayRecorder({
      sessionId: 'sess-1',
      uploader,
    });
    expect(handle.pendingEventCount()).toBe(0);
    expect(handle.forceFlush()).toBe(0);
    await handle.stop();
  });
});
