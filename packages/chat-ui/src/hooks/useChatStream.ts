/**
 * useChatStream — React hook that consumes an SSE chat stream from the
 * BORJIE gateway and exposes an incremental message buffer.
 *
 * The hook is transport-agnostic: pass an endpoint URL (default
 * `/api/v1/ai/chat`) and a persona id, and the hook handles:
 *   - POSTing the message body as a fetch request
 *   - parsing the SSE response body line-by-line
 *   - appending `delta` events into the current assistant message
 *   - exposing `toolCalls`, `toolResults`, `proposedAction`, `handoffs`
 *   - cancelling the in-flight request on unmount via AbortController
 *   - lightweight reconnection on transient errors
 *
 * The hook deliberately does NOT know about authentication — callers pass
 * any required headers via the `headers` option. For the unauthenticated
 * marketing chat the endpoint is `/api/v1/public/chat`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types — mirror the gateway `StreamTurnEvent` shape so both sides stay in sync
// ---------------------------------------------------------------------------

export type ChatStreamEvent =
  | { readonly type: 'turn_start'; readonly threadId: string; readonly personaId?: string; readonly createdAt: string }
  | { readonly type: 'delta'; readonly content: string }
  | { readonly type: 'tool_call'; readonly name: string; readonly args?: Record<string, unknown> }
  | { readonly type: 'tool_result'; readonly name: string; readonly ok: boolean }
  | {
      readonly type: 'proposed_action';
      readonly risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      readonly description: string;
      readonly reviewRequired: boolean;
      readonly executionHeld: boolean;
    }
  | { readonly type: 'handoff'; readonly from: string; readonly to: string; readonly objective: string }
  | { readonly type: 'error'; readonly code: string; readonly message: string; readonly retryable: boolean }
  | {
      readonly type: 'turn_end';
      readonly threadId: string;
      readonly finalPersonaId: string;
      readonly totalTokens: number;
      readonly totalCost: number;
      readonly timeMs: number;
      readonly advisorConsulted: boolean;
    };

export interface ChatStreamToolEntry {
  readonly name: string;
  readonly ok?: boolean;
  readonly args?: Record<string, unknown>;
}

export interface ChatStreamHandoff {
  readonly from: string;
  readonly to: string;
  readonly objective: string;
}

export interface ChatStreamProposedAction {
  readonly risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly description: string;
  readonly reviewRequired: boolean;
  readonly executionHeld: boolean;
  readonly decision?: 'approved' | 'rejected';
}

export interface ChatStreamState {
  readonly isStreaming: boolean;
  readonly threadId: string | null;
  readonly assistantText: string;
  readonly toolCalls: readonly ChatStreamToolEntry[];
  readonly handoffs: readonly ChatStreamHandoff[];
  readonly proposedAction: ChatStreamProposedAction | null;
  readonly error: string | null;
  readonly lastEvent: ChatStreamEvent | null;
  readonly totalTokens: number;
  readonly totalCost: number;
  readonly reconnectAttempt: number;
}

export interface UseChatStreamOptions {
  /** Gateway endpoint. Default `/api/v1/ai/chat`. */
  readonly endpoint?: string;
  /** Extra request headers (e.g. Authorization). */
  readonly headers?: Record<string, string>;
  /** Optional extra body fields sent with every sendMessage. */
  readonly extraBody?: Record<string, unknown>;
  /** Max reconnection attempts on transient network errors. Default 2. */
  readonly maxReconnect?: number;
  /** Called on every event — lets callers wire analytics or mode detection. */
  readonly onEvent?: (event: ChatStreamEvent) => void;
}

export interface SendMessageOptions {
  readonly threadId?: string;
  readonly subPersonaId?: string;
  readonly forcePersonaId?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const INITIAL_STATE: ChatStreamState = {
  isStreaming: false,
  threadId: null,
  assistantText: '',
  toolCalls: [],
  handoffs: [],
  proposedAction: null,
  error: null,
  lastEvent: null,
  totalTokens: 0,
  totalCost: 0,
  reconnectAttempt: 0,
};

export function useChatStream(
  personaId: string,
  options: UseChatStreamOptions = {}
): {
  readonly state: ChatStreamState;
  readonly sendMessage: (message: string, opts?: SendMessageOptions) => Promise<void>;
  readonly cancel: () => void;
  readonly reset: () => void;
  readonly approveAction: () => void;
  readonly rejectAction: () => void;
} {
  const {
    endpoint = '/api/v1/ai/chat',
    headers,
    extraBody,
    maxReconnect = 2,
    onEvent,
  } = options;

  const [state, setState] = useState<ChatStreamState>(INITIAL_STATE);

  // Mutable refs so the hook can be cancelled / unmounted cleanly without
  // tripping React's strict-mode double-invoke traps.
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  // Keep a stable callback ref so we can call `onEvent` without re-running
  // effects every time the consumer passes a fresh function.
  const onEventRef = useRef<typeof onEvent>(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const applyEvent = useCallback((event: ChatStreamEvent) => {
    if (!mountedRef.current) return;
    onEventRef.current?.(event);
    setState((prev) => reduceEvent(prev, event));
  }, []);

  const runStream = useCallback(
    async (message: string, opts: SendMessageOptions, attempt: number): Promise<void> => {
      if (!mountedRef.current) return;

      const abort = new AbortController();
      abortRef.current?.abort();
      abortRef.current = abort;

      setState((prev) => ({
        ...INITIAL_STATE,
        threadId: opts.threadId ?? prev.threadId,
        isStreaming: true,
        reconnectAttempt: attempt,
      }));

      const body = {
        personaId,
        subPersonaId: opts.subPersonaId,
        forcePersonaId: opts.forcePersonaId,
        threadId: opts.threadId,
        message,
        ...extraBody,
      };

      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            ...(headers ?? {}),
          },
          body: JSON.stringify(body),
          signal: abort.signal,
        });
      } catch (err) {
        if (abort.signal.aborted) return;
        if (attempt < maxReconnect) {
          return runStream(message, opts, attempt + 1);
        }
        applyEvent({
          type: 'error',
          code: 'NETWORK',
          message: err instanceof Error ? err.message : 'network error',
          retryable: true,
        });
        setState((prev) => ({ ...prev, isStreaming: false }));
        return;
      }

      if (!res.ok || !res.body) {
        applyEvent({
          type: 'error',
          code: `HTTP_${res.status}`,
          message: `chat endpoint returned ${res.status}`,
          retryable: res.status >= 500,
        });
        setState((prev) => ({ ...prev, isStreaming: false }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        // Simple SSE parser — split on double-newline, then split each event
        // into its `event:` / `data:` lines. Robust enough for our own server
        // output; not a full-featured EventSource replacement.
        // eslint-disable-next-line no-constant-condition -- SCRUB-5f: rule-disabled because the SSE reader exits via internal break conditions (unmount, abort, reader done)
        while (true) {
          if (!mountedRef.current || abort.signal.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';
          for (const raw of parts) {
            const ev = parseSseChunk(raw);
            if (ev) applyEvent(ev);
          }
        }
        // Flush tail
        if (buffer.trim().length > 0) {
          const ev = parseSseChunk(buffer);
          if (ev) applyEvent(ev);
        }
      } catch (err) {
        if (!abort.signal.aborted) {
          applyEvent({
            type: 'error',
            code: 'STREAM_READ',
            message: err instanceof Error ? err.message : 'stream read failed',
            retryable: true,
          });
        }
      } finally {
        if (mountedRef.current) {
          setState((prev) => ({ ...prev, isStreaming: false }));
        }
      }
    },
    [endpoint, headers, personaId, extraBody, maxReconnect, applyEvent]
  );

  const sendMessage = useCallback(
    async (message: string, opts: SendMessageOptions = {}) => {
      await runStream(message, opts, 0);
    },
    [runStream]
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL_STATE);
  }, []);

  const approveAction = useCallback(() => {
    setState((prev) =>
      prev.proposedAction
        ? { ...prev, proposedAction: { ...prev.proposedAction, decision: 'approved' } }
        : prev
    );
  }, []);

  const rejectAction = useCallback(() => {
    setState((prev) =>
      prev.proposedAction
        ? { ...prev, proposedAction: { ...prev.proposedAction, decision: 'rejected' } }
        : prev
    );
  }, []);

  return useMemo(
    () => ({ state, sendMessage, cancel, reset, approveAction, rejectAction }),
    [state, sendMessage, cancel, reset, approveAction, rejectAction]
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function reduceEvent(prev: ChatStreamState, ev: ChatStreamEvent): ChatStreamState {
  switch (ev.type) {
    case 'turn_start':
      return {
        ...prev,
        threadId: ev.threadId,
        assistantText: '',
        toolCalls: [],
        handoffs: [],
        proposedAction: null,
        error: null,
        lastEvent: ev,
        totalTokens: 0,
        totalCost: 0,
      };
    case 'delta':
      return {
        ...prev,
        assistantText: prev.assistantText + ev.content,
        lastEvent: ev,
      };
    case 'tool_call':
      return {
        ...prev,
        toolCalls: [...prev.toolCalls, { name: ev.name, args: ev.args }],
        lastEvent: ev,
      };
    case 'tool_result':
      return {
        ...prev,
        toolCalls: prev.toolCalls.map((t) =>
          t.name === ev.name && t.ok === undefined ? { ...t, ok: ev.ok } : t
        ),
        lastEvent: ev,
      };
    case 'handoff':
      return {
        ...prev,
        handoffs: [...prev.handoffs, { from: ev.from, to: ev.to, objective: ev.objective }],
        lastEvent: ev,
      };
    case 'proposed_action':
      return {
        ...prev,
        proposedAction: {
          risk: ev.risk,
          description: ev.description,
          reviewRequired: ev.reviewRequired,
          executionHeld: ev.executionHeld,
        },
        lastEvent: ev,
      };
    case 'error':
      return { ...prev, error: ev.message, lastEvent: ev };
    case 'turn_end':
      return {
        ...prev,
        isStreaming: false,
        threadId: ev.threadId,
        totalTokens: ev.totalTokens,
        totalCost: ev.totalCost,
        lastEvent: ev,
      };
    default:
      return prev;
  }
}

/**
 * Parse an SSE chunk of the form:
 *   event: <type>\n
 *   data: <json>\n\n
 *
 * Returns null for keep-alive comments or malformed blocks.
 */
export function parseSseChunk(chunk: string): ChatStreamEvent | null {
  const trimmed = chunk.trim();
  if (!trimmed || trimmed.startsWith(':')) return null;

  let eventType: string | null = null;
  let dataLines: string[] = [];
  for (const rawLine of trimmed.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('event:')) {
      eventType = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim());
    }
  }
  if (!eventType || dataLines.length === 0) return null;
  const jsonStr = dataLines.join('\n');
  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    return { type: eventType, ...parsed } as ChatStreamEvent;
  } catch {
    return null;
  }
}
