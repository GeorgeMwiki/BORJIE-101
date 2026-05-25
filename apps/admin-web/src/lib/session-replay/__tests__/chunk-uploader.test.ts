/**
 * chunk-uploader — unit tests.
 *
 * Covers the contract the recorder relies on:
 *
 *   1. enqueue + flush calls the configured fetch with auth + body
 *   2. successful POST → buffer drains, getStats() reports
 *   3. transient failure → retry, then re-queue at the head of buffer
 *   4. 4xx (non-retryable) → chunk is dropped silently
 *   5. flushOnUnload uses sendBeacon when present
 *   6. aged chunks (older than maxAgeMs) are pruned on flush
 *   7. buffer cap enforced — oldest chunks evicted, dropped counter ticks
 *   8. concurrent flush() calls are coalesced (no double-send)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createChunkUploader,
  type SessionReplayChunk,
} from '../chunk-uploader';

function fakeChunk(
  seq: number,
  overrides: Partial<SessionReplayChunk> = {},
): SessionReplayChunk {
  return {
    sessionId: 'sess-1',
    sequenceNumber: seq,
    capturedAt: new Date().toISOString(),
    eventCount: 5,
    eventsJson: JSON.stringify([{ type: 2, timestamp: Date.now() }]),
    surface: 'admin-web',
    ...overrides,
  };
}

function okResponse(): Response {
  // Cast through any — jsdom's Response constructor handles strings.
  return new Response('{}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createChunkUploader', () => {
  it('flush() POSTs the chunk with auth header and JSON body', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const uploader = createChunkUploader({
      endpoint: 'https://api.test/session-replay/chunks',
      authToken: 'tok-abc',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    uploader.enqueue(fakeChunk(0));
    await uploader.flush();
    expect(fetchImpl).toHaveBeenCalledOnce();
    const call0 = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const init = call0[1];
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-abc');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(String(init.body));
    expect(body.sessionId).toBe('sess-1');
    expect(body.sequenceNumber).toBe(0);
    expect(typeof body.eventsGzipBase64).toBe('string');
    expect(body.eventsGzipBase64.length).toBeGreaterThan(0);
  });

  it('drains the buffer + records successfulUploads on 200', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const uploader = createChunkUploader({
      endpoint: '/x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    uploader.enqueue(fakeChunk(0));
    uploader.enqueue(fakeChunk(1));
    await uploader.flush();
    const stats = uploader.getStats();
    expect(stats.bufferedChunks).toBe(0);
    expect(stats.successfulUploads).toBe(2);
  });

  it('re-queues at the head on transient failure', async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts += 1;
      if (attempts < 4) throw new Error('network down');
      return okResponse();
    });
    const uploader = createChunkUploader({
      endpoint: '/x',
      maxRetries: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      // Avoid the real 500ms backoff sleeps.
      logger: () => undefined,
    });
    uploader.enqueue(fakeChunk(0));
    await uploader.flush();
    // 2 retries failed → chunk still buffered.
    expect(uploader.getStats().bufferedChunks).toBe(1);
    // Next flush succeeds.
    await uploader.flush();
    expect(uploader.getStats().bufferedChunks).toBe(0);
    expect(uploader.getStats().successfulUploads).toBeGreaterThan(0);
  });

  it('drops the chunk on a 400-class response (non-retryable)', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{}', { status: 400 }),
    );
    const uploader = createChunkUploader({
      endpoint: '/x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: () => undefined,
    });
    uploader.enqueue(fakeChunk(0));
    await uploader.flush();
    // Chunk handled (treated as "consumed") so buffer is empty.
    expect(uploader.getStats().bufferedChunks).toBe(0);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('flushOnUnload uses sendBeacon and drains buffer', () => {
    const beacon = vi.fn(() => true);
    const uploader = createChunkUploader({
      endpoint: '/x',
      sendBeacon: beacon as unknown as typeof navigator.sendBeacon,
    });
    uploader.enqueue(fakeChunk(0));
    uploader.enqueue(fakeChunk(1));
    const result = uploader.flushOnUnload();
    expect(result).toBe(true);
    expect(beacon).toHaveBeenCalledTimes(2);
    expect(uploader.getStats().bufferedChunks).toBe(0);
  });

  it('prunes aged chunks (> maxAgeMs) on next flush', async () => {
    let now = 1_000_000;
    const fetchImpl = vi.fn(async () => okResponse());
    const uploader = createChunkUploader({
      endpoint: '/x',
      maxAgeMs: 10_000,
      clock: () => now,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    uploader.enqueue(fakeChunk(0));
    // Move clock past the age cutoff before flush.
    now += 30_000;
    await uploader.flush();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(uploader.getStats().droppedChunks).toBe(1);
  });

  it('enforces buffer-size cap (drops oldest)', () => {
    const uploader = createChunkUploader({
      endpoint: '/x',
      maxBufferBytes: 256,
    });
    // 6 chunks @ ~100 bytes each exceeds the 256-byte cap.
    for (let i = 0; i < 6; i += 1) {
      uploader.enqueue(
        fakeChunk(i, {
          eventsJson: JSON.stringify(
            Array.from({ length: 5 }, () => ({ type: 2, timestamp: i })),
          ),
        }),
      );
    }
    const stats = uploader.getStats();
    expect(stats.bufferedBytes).toBeLessThanOrEqual(256);
    expect(stats.droppedChunks).toBeGreaterThan(0);
  });

  it('flush() is coalesced — concurrent calls do not double-send', async () => {
    let inflight = 0;
    let maxInflight = 0;
    const fetchImpl = vi.fn(async () => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 10));
      inflight -= 1;
      return okResponse();
    });
    const uploader = createChunkUploader({
      endpoint: '/x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    uploader.enqueue(fakeChunk(0));
    await Promise.all([uploader.flush(), uploader.flush()]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(maxInflight).toBe(1);
  });

  it('authToken function form is invoked at flush time', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    let counter = 0;
    const uploader = createChunkUploader({
      endpoint: '/x',
      authToken: () => `t-${++counter}`,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    uploader.enqueue(fakeChunk(0));
    uploader.enqueue(fakeChunk(1));
    await uploader.flush();
    const calls = fetchImpl.mock.calls as unknown as Array<
      [string, RequestInit]
    >;
    const headers0 = (calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
    const headers1 = (calls[1]?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers0.Authorization).toBe('Bearer t-1');
    expect(headers1.Authorization).toBe('Bearer t-2');
  });
});
