'use client';

/**
 * use-raf-flush — coalesce per-token SSE writes into ~one React commit per
 * animation frame.
 *
 * The brain-teach stream pushes a `message_chunk` per token at network
 * cadence. Calling `setMessages` once per chunk makes words "pop" at the
 * socket's jittery rate and thrashes React (a re-parse + reconcile per
 * token). This hook buffers incoming text in a ref and flushes the joined
 * buffer to a caller-supplied sink at most once per `requestAnimationFrame`
 * (≈ 60 Hz, throttled by the browser to the display) — falling back to a
 * 50 ms timer when rAF is unavailable (SSR / jsdom). The visual result is a
 * steady ~20–60 commits/sec instead of one-per-token.
 *
 * Immutability: the buffer is a string ref; the sink receives the *delta*
 * text and folds it into immutable React state itself. The hook never
 * mutates the caller's state.
 *
 * Abort discipline (HARD): `cancel()` clears the pending buffer AND cancels
 * the queued frame so a token that arrived microseconds before Stop can
 * never land after the owner aborted (no stale-token tail).
 */

import { useCallback, useEffect, useRef } from 'react';

export interface RafFlush {
  /** Queue a chunk of text; it will be flushed on the next frame. */
  readonly push: (chunk: string) => void;
  /** Flush any buffered text immediately (e.g. at stream end). */
  readonly flushNow: () => void;
  /** Drop buffered text and cancel the queued frame (Stop / abort). */
  readonly cancel: () => void;
}

type FrameHandle =
  | { readonly kind: 'raf'; readonly id: number }
  | { readonly kind: 'timer'; readonly id: ReturnType<typeof setTimeout> };

const FALLBACK_MS = 50;

function scheduleFrame(run: () => void): FrameHandle {
  if (typeof requestAnimationFrame === 'function') {
    return { kind: 'raf', id: requestAnimationFrame(run) };
  }
  return { kind: 'timer', id: setTimeout(run, FALLBACK_MS) };
}

function clearFrame(handle: FrameHandle): void {
  if (handle.kind === 'raf') {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle.id);
  } else {
    clearTimeout(handle.id);
  }
}

/**
 * @param onFlush  Called with the coalesced text delta once per frame. Keep
 *                 it referentially stable (wrap in useCallback) — the hook
 *                 reads the latest via a ref so a changing identity never
 *                 re-arms the loop.
 */
export function useRafFlush(onFlush: (text: string) => void): RafFlush {
  const bufferRef = useRef('');
  const frameRef = useRef<FrameHandle | null>(null);
  const sinkRef = useRef(onFlush);
  sinkRef.current = onFlush;

  const drain = useCallback((): void => {
    frameRef.current = null;
    const text = bufferRef.current;
    if (text.length === 0) return;
    bufferRef.current = '';
    sinkRef.current(text);
  }, []);

  const push = useCallback(
    (chunk: string): void => {
      if (!chunk) return;
      bufferRef.current += chunk;
      if (frameRef.current === null) {
        frameRef.current = scheduleFrame(drain);
      }
    },
    [drain],
  );

  const flushNow = useCallback((): void => {
    if (frameRef.current !== null) {
      clearFrame(frameRef.current);
      frameRef.current = null;
    }
    drain();
  }, [drain]);

  const cancel = useCallback((): void => {
    bufferRef.current = '';
    if (frameRef.current !== null) {
      clearFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  // Defensive unmount cleanup — a queued frame must never fire into a sink
  // whose host component has unmounted.
  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        clearFrame(frameRef.current);
        frameRef.current = null;
      }
      bufferRef.current = '';
    };
  }, []);

  return { push, flushNow, cancel };
}
