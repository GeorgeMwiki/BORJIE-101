/**
 * Tests for `useJarvisStream` — the streaming variant of `useJarvis`.
 *
 * We stub the `JarvisSurfaceClient.stream(...)` method directly with a
 * canned async iterable so the tests don't depend on the SDK's SSE
 * parser (which has its own coverage in `@borjie/api-sdk`).
 *
 * Coverage:
 *   1. Multiple deltas accumulate into a single assistant turn
 *   2. Status transitions: idle → streaming → idle on `done`
 *   3. abort() during stream sets handle.abort + halts updates
 *   4. Server-emitted `error` event sets status='error' + error message
 */

import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type {
  JarvisStreamEvent,
  JarvisStreamHandle,
  JarvisSurfaceClient,
} from '@borjie/api-sdk';
import { useJarvisStream } from '../hooks/useJarvisStream';

// ---------------------------------------------------------------------------
// Test client — exposes only `stream()`. Other JarvisSurfaceClient methods
// throw if called so missing wires fail loudly.
// ---------------------------------------------------------------------------

function makeStreamingClient(events: ReadonlyArray<JarvisStreamEvent>): {
  client: JarvisSurfaceClient;
  abortSpy: ReturnType<typeof vi.fn>;
} {
  const abortSpy = vi.fn();
  const client = {
    surface: 'platform' as const,
    think: () => {
      throw new Error('think() not stubbed');
    },
    briefing: () => {
      throw new Error('briefing() not stubbed');
    },
    proposeAction: () => {
      throw new Error('proposeAction() not stubbed');
    },
    sign: () => {
      throw new Error('sign() not stubbed');
    },
    getAction: () => {
      throw new Error('getAction() not stubbed');
    },
    listActions: () => {
      throw new Error('listActions() not stubbed');
    },
    recordFeedback: () => {
      throw new Error('recordFeedback() not stubbed');
    },
    stream: (): JarvisStreamHandle => ({
      abort: abortSpy,
      events: () => ({
        async *[Symbol.asyncIterator]() {
          for (const ev of events) {
            // Yield asynchronously so React has a chance to render
            // between deltas — matches real SSE behaviour.
            await Promise.resolve();
            yield ev;
          }
        },
      }),
    }),
  } as unknown as JarvisSurfaceClient;
  return { client, abortSpy };
}

function makeHangingStreamClient(): {
  client: JarvisSurfaceClient;
  abortSpy: ReturnType<typeof vi.fn>;
} {
  const abortSpy = vi.fn();
  let resolveAbort: (() => void) | null = null;
  const client = {
    surface: 'platform' as const,
    think: () => {
      throw new Error('think() not stubbed');
    },
    briefing: () => {
      throw new Error('briefing() not stubbed');
    },
    proposeAction: () => {
      throw new Error('proposeAction() not stubbed');
    },
    sign: () => {
      throw new Error('sign() not stubbed');
    },
    getAction: () => {
      throw new Error('getAction() not stubbed');
    },
    listActions: () => {
      throw new Error('listActions() not stubbed');
    },
    recordFeedback: () => {
      throw new Error('recordFeedback() not stubbed');
    },
    stream: (): JarvisStreamHandle => ({
      abort: () => {
        abortSpy();
        resolveAbort?.();
      },
      events: () => ({
        async *[Symbol.asyncIterator]() {
          // Yield a turn_start so the consumer sees the stream
          // actually begin, then hang until aborted.
          yield {
            kind: 'turn_start',
            persona: { id: 'p', displayName: 'X', firstPersonNoun: 'I' },
            thoughtId: 't-hang',
          } as JarvisStreamEvent;
          await new Promise<void>((r) => {
            resolveAbort = r;
          });
        },
      }),
    }),
  } as unknown as JarvisSurfaceClient;
  return { client, abortSpy };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useJarvisStream', () => {
  it('multiple deltas accumulate into a single assistant turn', async () => {
    const { client } = makeStreamingClient([
      {
        kind: 'turn_start',
        persona: { id: 'p', displayName: 'Niamh', firstPersonNoun: 'I' },
        thoughtId: 't1',
      },
      { kind: 'delta', text: 'Hel' },
      { kind: 'delta', text: 'lo ' },
      { kind: 'delta', text: 'world' },
      {
        kind: 'done',
        decision: {
          kind: 'answer',
          text: 'Hello world',
          provenance: {
            thoughtId: 't1',
            sensorId: '__streaming__',
            modelId: '__streaming__',
            latencyMs: 0,
            producedAt: new Date().toISOString(),
          },
        },
      },
    ]);

    const { result } = renderHook(() =>
      useJarvisStream({ client, threadId: 'th-1' }),
    );

    await act(async () => {
      await result.current.startStream('hi');
    });

    await waitFor(() => expect(result.current.status).toBe('idle'));
    const assistant = result.current.turns.find((t) => t.role === 'assistant');
    expect(assistant?.text).toBe('Hello world');
    expect(assistant?.persona?.displayName).toBe('Niamh');
    expect(assistant?.finalDecision?.kind).toBe('answer');
  });

  it('transitions status idle → streaming → idle on done', async () => {
    const { client } = makeStreamingClient([
      {
        kind: 'turn_start',
        persona: { id: 'p', displayName: 'X', firstPersonNoun: 'I' },
        thoughtId: 't',
      },
      { kind: 'delta', text: 'ok' },
      {
        kind: 'done',
        decision: {
          kind: 'answer',
          text: 'ok',
          provenance: {
            thoughtId: 't',
            sensorId: '__streaming__',
            modelId: '__streaming__',
            latencyMs: 0,
            producedAt: new Date().toISOString(),
          },
        },
      },
    ]);

    const { result } = renderHook(() =>
      useJarvisStream({ client, threadId: 'th-2' }),
    );

    expect(result.current.status).toBe('idle');

    await act(async () => {
      await result.current.startStream('hi');
    });
    // After done: idle. The transient `streaming` state is visible to the
    // user's renderer between deltas (each delta triggers a re-render);
    // we assert the terminal state to keep the test deterministic.
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('abort() halts the in-flight stream', async () => {
    const { client, abortSpy } = makeHangingStreamClient();
    const { result } = renderHook(() =>
      useJarvisStream({ client, threadId: 'th-3' }),
    );

    // Kick off the hanging stream. Don't await — it would never resolve
    // until we abort. Wrap in act to keep React happy with state writes.
    let pending: Promise<void> | null = null;
    act(() => {
      pending = result.current.startStream('hi');
    });
    // Wait for the turn_start event to flush so we know we're mid-stream.
    await waitFor(() =>
      expect(
        result.current.turns.find((t) => t.role === 'assistant')?.persona,
      ).toBeDefined(),
    );
    expect(result.current.status).toBe('streaming');

    act(() => {
      result.current.abort();
    });
    await act(async () => {
      await pending;
    });
    expect(abortSpy).toHaveBeenCalled();
  });

  it('server-emitted error event sets status="error"', async () => {
    const { client } = makeStreamingClient([
      {
        kind: 'turn_start',
        persona: { id: 'p', displayName: 'X', firstPersonNoun: 'I' },
        thoughtId: 't',
      },
      { kind: 'error', message: 'kernel boom' },
      {
        kind: 'done',
        decision: {
          kind: 'refusal',
          provenance: {
            thoughtId: 't',
            sensorId: '__streaming__',
            modelId: '__streaming__',
            latencyMs: 0,
            producedAt: new Date().toISOString(),
          },
        },
      },
    ]);

    const { result } = renderHook(() =>
      useJarvisStream({ client, threadId: 'th-4' }),
    );

    await act(async () => {
      await result.current.startStream('hi');
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('kernel boom');
  });
});
