/**
 * Tests for `useChatStream` — the shared SSE consumer for every chat page.
 *
 * We exercise the pure SSE parser directly (fast + deterministic) and then
 * test the hook via the React Testing Library, stubbing `global.fetch` with
 * a ReadableStream so no real network is needed.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { parseSseChunk, useChatStream } from '../hooks/useChatStream';

describe('parseSseChunk', () => {
  it('parses a turn_start event', () => {
    const ev = parseSseChunk('event: turn_start\ndata: {"threadId":"t-1","createdAt":"now"}');
    expect(ev).toEqual({ type: 'turn_start', threadId: 't-1', createdAt: 'now' });
  });

  it('parses a delta event with content', () => {
    const ev = parseSseChunk('event: delta\ndata: {"content":"hello"}');
    expect(ev).toEqual({ type: 'delta', content: 'hello' });
  });

  it('ignores SSE keep-alive comments', () => {
    expect(parseSseChunk(': keep-alive')).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    expect(parseSseChunk('event: delta\ndata: not-json')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Hook tests — stub fetch with a chunked ReadableStream.
// ---------------------------------------------------------------------------

function makeSseResponse(events: Array<{ event: string; data: unknown }>): Response {
  const encoder = new TextEncoder();
  const chunks = events.map(
    (e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`
  );
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('useChatStream', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('appends delta content and finalises on turn_end', async () => {
    global.fetch = vi.fn(async () =>
      makeSseResponse([
        { event: 'turn_start', data: { threadId: 't-1', createdAt: 'now' } },
        { event: 'delta', data: { content: 'Hello ' } },
        { event: 'delta', data: { content: 'world' } },
        { event: 'tool_call', data: { name: 'graph.search' } },
        { event: 'tool_result', data: { name: 'graph.search', ok: true } },
        {
          event: 'turn_end',
          data: {
            threadId: 't-1',
            finalPersonaId: 'manager-chat',
            totalTokens: 42,
            totalCost: 0.001,
            timeMs: 10,
            advisorConsulted: false,
          },
        },
      ]),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useChatStream('manager-chat'));

    await act(async () => {
      await result.current.sendMessage('hi');
    });

    await waitFor(() => expect(result.current.state.isStreaming).toBe(false));
    expect(result.current.state.assistantText).toBe('Hello world');
    expect(result.current.state.toolCalls).toHaveLength(1);
    expect(result.current.state.toolCalls[0]).toMatchObject({ name: 'graph.search', ok: true });
    expect(result.current.state.totalTokens).toBe(42);
  });

  it('reports error events in state', async () => {
    global.fetch = vi.fn(async () =>
      makeSseResponse([
        { event: 'turn_start', data: { threadId: 't-2', createdAt: 'now' } },
        { event: 'error', data: { code: 'EXECUTOR_FAILED', message: 'boom', retryable: false } },
        {
          event: 'turn_end',
          data: {
            threadId: 't-2',
            finalPersonaId: 'manager-chat',
            totalTokens: 0,
            totalCost: 0,
            timeMs: 1,
            advisorConsulted: false,
          },
        },
      ]),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useChatStream('manager-chat'));
    await act(async () => {
      await result.current.sendMessage('hi');
    });
    await waitFor(() => expect(result.current.state.error).toBe('boom'));
  });

  it('captures proposed actions', async () => {
    global.fetch = vi.fn(async () =>
      makeSseResponse([
        { event: 'turn_start', data: { threadId: 't-3', createdAt: 'now' } },
        { event: 'delta', data: { content: 'I propose' } },
        {
          event: 'proposed_action',
          data: {
            risk: 'MEDIUM',
            description: 'issue 14-day notice',
            reviewRequired: true,
            executionHeld: true,
          },
        },
        {
          event: 'turn_end',
          data: {
            threadId: 't-3',
            finalPersonaId: 'manager-chat',
            totalTokens: 10,
            totalCost: 0,
            timeMs: 1,
            advisorConsulted: false,
          },
        },
      ]),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useChatStream('manager-chat'));
    await act(async () => {
      await result.current.sendMessage('go');
    });
    await waitFor(() => expect(result.current.state.proposedAction).not.toBeNull());
    expect(result.current.state.proposedAction?.risk).toBe('MEDIUM');

    act(() => {
      result.current.approveAction();
    });
    expect(result.current.state.proposedAction?.decision).toBe('approved');
  });

  it('aborts the in-flight request on cancel()', async () => {
    const aborted = vi.fn();
    global.fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', aborted);
      // Never resolves — simulates a slow server.
      return new Promise<Response>(() => undefined);
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useChatStream('manager-chat'));
    void result.current.sendMessage('hi');
    act(() => {
      result.current.cancel();
    });
    expect(aborted).toHaveBeenCalled();
  });
});
