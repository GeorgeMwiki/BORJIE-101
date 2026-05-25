/**
 * AG-UI client hook — React surface for the Central-Command brain wire.
 *
 * Why not `EventSource`?  Native `EventSource` cannot POST a body and
 * cannot attach an Authorization header, so we use `fetch` + the
 * existing `readSseStream` helper (lib/sse.ts) and parse AG-UI events
 * on the client.
 *
 * Lifecycle:
 *   - `send(message, presence)` opens a fresh POST to
 *     `/api/platform/intelligence/thread/:threadId/message` (the Next
 *     route proxy → api-gateway).
 *   - Each parsed SSE frame is fed through `validateAgUiEvent` and
 *     handed to the `onEvent` callback. Malformed events are
 *     discarded (the proxy + emitter validate server-side; this is
 *     belt-and-braces).
 *   - On disconnect, the hook auto-reconnects with exponential
 *     backoff (250ms × 2^n, capped at 8s, up to 6 attempts) IFF the
 *     last run did not emit a terminal RUN_FINISHED / RUN_ERROR. A
 *     clean terminal counts as success and disarms the retry loop.
 *
 * Immutability: state setters always pass a NEW object — the React
 * tree never sees a mutated AgUiEvent. The retry counter and last
 * presence packet live inside a `useRef` so they don't trigger renders.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AG_UI_TERMINAL_EVENT_TYPES,
  validateAgUiEvent,
  type AgUiEvent,
} from '@borjie/central-intelligence';
import { readSseStream, parseSseBuffer } from './sse';

export type AgUiStreamStatus = 'idle' | 'streaming' | 'error' | 'reconnecting';

export interface PresencePacket {
  readonly route?: string;
  readonly focus?: string;
  readonly selection?: string;
  readonly lastQuery?: string;
  readonly extra?: Readonly<Record<string, unknown>>;
}

export interface UseAgUiStreamOptions {
  readonly threadId: string;
  readonly onEvent: (event: AgUiEvent) => void;
  /** Override the proxy path. Defaults to the Next.js central-command route. */
  readonly endpoint?: (threadId: string) => string;
  /** Maximum reconnect attempts. Defaults to 6. Set to 0 to disable retries. */
  readonly maxReconnectAttempts?: number;
  /** Initial backoff in ms. Defaults to 250. Doubles per attempt, capped at 8000. */
  readonly initialBackoffMs?: number;
}

export interface UseAgUiStreamHandle {
  readonly status: AgUiStreamStatus;
  readonly lastError: string | null;
  readonly send: (message: string, presence?: PresencePacket) => Promise<void>;
  readonly cancel: () => void;
}

const DEFAULT_MAX_RETRIES = 6;
const DEFAULT_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 8_000;

function defaultEndpoint(threadId: string): string {
  return `/api/platform/intelligence/thread/${encodeURIComponent(threadId)}/message`;
}

interface PendingRequest {
  readonly message: string;
  readonly presence?: PresencePacket;
  readonly attempt: number;
  /** RUN ids we've already dispatched to the consumer — drop dupes on replay. */
  readonly seenEventKeys: Set<string>;
}

function eventKey(event: AgUiEvent): string | null {
  // Build a stable de-dupe key per AG-UI event type. Reconnect replays
  // are uncommon today (the gateway doesn't emit Last-Event-ID), but we
  // future-proof so an upgraded gateway that does replay won't double
  // up the consumer's UI.
  switch (event.type) {
    case 'RUN_STARTED':
      return `${event.type}:${event.runId}`;
    case 'RUN_FINISHED':
    case 'RUN_ERROR':
      return `${event.type}:${event.runId}`;
    case 'TEXT_MESSAGE_START':
    case 'TEXT_MESSAGE_END':
      return `${event.type}:${event.messageId}`;
    case 'TEXT_MESSAGE_CONTENT':
      return `${event.type}:${event.messageId}:${event.delta.length}`;
    case 'TOOL_CALL_START':
    case 'TOOL_CALL_END':
      return `${event.type}:${event.toolCallId}`;
    case 'TOOL_CALL_ARGS':
      return `${event.type}:${event.toolCallId}:${event.delta.length}`;
    case 'TOOL_RESULT':
      return `${event.type}:${event.toolCallId}`;
    case 'STATE_DELTA':
    case 'STATE_SNAPSHOT':
      // No natural key — these are inherently ordered; let the
      // consumer dedupe semantically if it cares.
      return null;
  }
  // Unreachable — the switch is exhaustive over AgUiEvent. Explicit
  // fallthrough keeps `noImplicitReturns` (and lint-stricter
  // downstream forks) happy.
  return null;
}

export function useAgUiStream(
  options: UseAgUiStreamOptions,
): UseAgUiStreamHandle {
  const {
    threadId,
    onEvent,
    endpoint = defaultEndpoint,
    maxReconnectAttempts = DEFAULT_MAX_RETRIES,
    initialBackoffMs = DEFAULT_BACKOFF_MS,
  } = options;

  const [status, setStatus] = useState<AgUiStreamStatus>('idle');
  const [lastError, setLastError] = useState<string | null>(null);

  // Mutable bag — refs so re-renders don't bin our in-flight state.
  const abortRef = useRef<AbortController | null>(null);
  const onEventRef = useRef(onEvent);
  // Keep the callback ref fresh without re-running effects.
  onEventRef.current = onEvent;

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setStatus('idle');
  }, []);

  // Tear down any in-flight request on unmount.
  useEffect(() => () => cancel(), [cancel]);

  const dispatch = useCallback(
    async (pending: PendingRequest): Promise<void> => {
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus(pending.attempt === 0 ? 'streaming' : 'reconnecting');
      setLastError(null);

      let terminalEmitted = false;
      try {
        const response = await fetch(endpoint(threadId), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          credentials: 'include',
          body: JSON.stringify({
            message: pending.message,
            ...(pending.presence ? { presence: pending.presence } : {}),
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(
            response.body
              ? `HTTP ${response.status}`
              : `HTTP ${response.status} (empty body)`,
          );
        }

        await readSseStream(
          response.body,
          (rawEvent) => {
            // Parse the AG-UI envelope from the SSE event.data JSON.
            let parsed: unknown;
            try {
              parsed = JSON.parse(rawEvent.data);
            } catch {
              return;
            }
            const verdict = validateAgUiEvent(parsed);
            if (!verdict.ok) return;
            const event = parsed as AgUiEvent;
            const key = eventKey(event);
            if (key && pending.seenEventKeys.has(key)) return;
            if (key) pending.seenEventKeys.add(key);
            if (
              (AG_UI_TERMINAL_EVENT_TYPES as ReadonlyArray<string>).includes(
                event.type,
              )
            ) {
              terminalEmitted = true;
            }
            onEventRef.current(event);
          },
          controller.signal,
        );

        // Stream closed cleanly. If we saw a terminal event, we're
        // done. If not (mid-run disconnect), schedule a retry.
        if (!terminalEmitted) {
          throw new Error('stream-ended-without-terminal');
        }
        setStatus('idle');
      } catch (err) {
        if (controller.signal.aborted) {
          setStatus('idle');
          return;
        }
        const detail = err instanceof Error ? err.message : 'stream-error';
        setLastError(detail);
        if (
          !terminalEmitted &&
          pending.attempt < maxReconnectAttempts
        ) {
          const delay = Math.min(
            initialBackoffMs * 2 ** pending.attempt,
            MAX_BACKOFF_MS,
          );
          setStatus('reconnecting');
          await new Promise((resolve) => setTimeout(resolve, delay));
          if (controller.signal.aborted) return;
          await dispatch({
            ...pending,
            attempt: pending.attempt + 1,
          });
          return;
        }
        setStatus('error');
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [endpoint, initialBackoffMs, maxReconnectAttempts, threadId],
  );

  const send = useCallback(
    async (message: string, presence?: PresencePacket): Promise<void> => {
      // Pre-empt any in-flight request — the AG-UI contract is one
      // active run per thread surface.
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      const pending: PendingRequest = {
        message,
        ...(presence ? { presence } : {}),
        attempt: 0,
        seenEventKeys: new Set<string>(),
      };
      await dispatch(pending);
    },
    [dispatch],
  );

  return { status, lastError, send, cancel };
}

// ─────────────────────────────────────────────────────────────────────
// Test-only exports — the hook composes pure helpers we want to assert
// in isolation. Kept in the same module so they share types with the
// hook itself.
// ─────────────────────────────────────────────────────────────────────

export const __test = {
  eventKey,
  defaultEndpoint,
  parseSseBuffer,
  MAX_BACKOFF_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_BACKOFF_MS,
} as const;
