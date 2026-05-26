'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE } from './api-client';

/**
 * Tiny SSE-over-fetch hook for the Master Brain stream.
 *
 * Browsers can't `POST` from `EventSource`, so this opens a streaming
 * fetch (`Accept: text/event-stream`), parses each `data: {...}` line
 * and surfaces the four event kinds the gateway emits today:
 *
 *   junior_calls   — orchestration breadcrumb ("Geology · resolve")
 *   message_chunks — incremental assistant text
 *   evidence_ids   — citation panel hints
 *   done           — terminal marker
 *
 * The hook is fully cancelable: calling `cancel()` aborts the fetch and
 * the underlying reader; unmounting does the same.
 */

export interface SseJuniorCall {
  readonly agent: string;
  readonly action: string;
  readonly latencyMs?: number;
}

export interface SseEvidence {
  readonly id: string;
  readonly source?: string;
}

export interface SseStreamState {
  readonly text: string;
  readonly juniorCalls: ReadonlyArray<SseJuniorCall>;
  readonly evidenceIds: ReadonlyArray<string>;
  readonly streaming: boolean;
  readonly error: string | null;
  readonly done: boolean;
}

const INITIAL_STATE: SseStreamState = {
  text: '',
  juniorCalls: [],
  evidenceIds: [],
  streaming: false,
  error: null,
  done: false,
};

interface UseSseOptions {
  readonly endpoint: string;
  readonly onJuniorCall?: (call: SseJuniorCall) => void;
  readonly onMessageChunk?: (chunk: string) => void;
  readonly onEvidence?: (ids: ReadonlyArray<string>) => void;
  readonly onDone?: () => void;
}

interface OpenInput<TBody> {
  readonly body: TBody;
  readonly headers?: Record<string, string>;
}

export function useSSE<TBody>(opts: UseSseOptions): {
  readonly state: SseStreamState;
  readonly open: (input: OpenInput<TBody>) => Promise<void>;
  readonly cancel: () => void;
  readonly reset: () => void;
} {
  const [state, setState] = useState<SseStreamState>(INITIAL_STATE);
  const controllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback((): void => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState((prev) => ({ ...prev, streaming: false }));
  }, []);

  const reset = useCallback((): void => {
    cancel();
    setState(INITIAL_STATE);
  }, [cancel]);

  const open = useCallback(
    async ({ body, headers }: OpenInput<TBody>): Promise<void> => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setState({ ...INITIAL_STATE, streaming: true });

      const url = `${API_BASE.replace(/\/+$/, '')}${opts.endpoint}`;
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            ...(typeof window !== 'undefined' && window.sessionStorage.getItem('platform_token')
              ? { Authorization: `Bearer ${window.sessionStorage.getItem('platform_token')}` }
              : {}),
            ...headers,
          },
          body: JSON.stringify(body),
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : 'sse open failed';
        setState({ ...INITIAL_STATE, error: message });
        return;
      }

      if (!response.ok || !response.body) {
        setState({ ...INITIAL_STATE, error: `sse stream failed (HTTP ${response.status})` });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (controller.signal.aborted) return;
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split('\n\n');
          buffer = blocks.pop() ?? '';
          for (const block of blocks) {
            const event = parseBlock(block);
            if (!event) continue;
            applyEvent(event, opts, setState);
            if (event.name === 'done') {
              opts.onDone?.();
              return;
            }
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : 'sse stream failed';
        setState((prev) => ({ ...prev, streaming: false, error: message }));
      } finally {
        setState((prev) => (prev.streaming ? { ...prev, streaming: false } : prev));
      }
    },
    [opts],
  );

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { state, open, cancel, reset };
}

interface ParsedEvent {
  readonly name: string;
  readonly data: unknown;
}

function parseBlock(raw: string): ParsedEvent | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith(':')) return null;
  let name = 'message';
  const dataLines: string[] = [];
  for (const rawLine of trimmed.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('event:')) {
      name = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim());
    }
  }
  if (dataLines.length === 0) return null;
  const joined = dataLines.join('\n');
  try {
    return { name, data: JSON.parse(joined) };
  } catch {
    return { name, data: joined };
  }
}

function applyEvent(
  event: ParsedEvent,
  opts: UseSseOptions,
  set: (updater: (prev: SseStreamState) => SseStreamState) => void,
): void {
  // Gateway events live in services/api-gateway/src/routes/mining/chat.hono.ts.
  switch (event.name) {
    case 'message_chunks':
    case 'message_chunk': {
      const chunk =
        isRecord(event.data) && typeof event.data.chunk === 'string' ? event.data.chunk : '';
      if (chunk) {
        opts.onMessageChunk?.(chunk);
        set((prev) => ({ ...prev, text: prev.text + chunk }));
      }
      return;
    }
    case 'junior_calls': {
      const calls = isRecord(event.data) && Array.isArray(event.data.calls) ? event.data.calls : [];
      const normalised: SseJuniorCall[] = [];
      for (const call of calls) {
        if (!isRecord(call)) continue;
        const entry: SseJuniorCall = {
          agent: String(call.agent ?? 'agent'),
          action: String(call.action ?? 'run'),
          latencyMs: typeof call.latencyMs === 'number' ? call.latencyMs : undefined,
        };
        normalised.push(entry);
        opts.onJuniorCall?.(entry);
      }
      if (normalised.length > 0) {
        set((prev) => ({ ...prev, juniorCalls: [...prev.juniorCalls, ...normalised] }));
      }
      return;
    }
    case 'junior_call': {
      if (!isRecord(event.data)) return;
      const entry: SseJuniorCall = {
        agent: String(event.data.agent ?? 'agent'),
        action: String(event.data.action ?? 'run'),
        latencyMs:
          typeof event.data.latencyMs === 'number' ? event.data.latencyMs : undefined,
      };
      opts.onJuniorCall?.(entry);
      set((prev) => ({ ...prev, juniorCalls: [...prev.juniorCalls, entry] }));
      return;
    }
    case 'evidence_ids':
    case 'evidence_id':
    case 'evidence': {
      if (!isRecord(event.data)) return;
      const ids = Array.isArray(event.data.ids)
        ? event.data.ids.map(String)
        : typeof event.data.id === 'string'
          ? [event.data.id]
          : [];
      if (ids.length > 0) {
        opts.onEvidence?.(ids);
        set((prev) => ({ ...prev, evidenceIds: [...prev.evidenceIds, ...ids] }));
      }
      return;
    }
    case 'done': {
      set((prev) => ({ ...prev, streaming: false, done: true }));
      return;
    }
    case 'error': {
      const message =
        isRecord(event.data) && typeof event.data.message === 'string'
          ? event.data.message
          : 'stream error';
      set((prev) => ({ ...prev, streaming: false, error: message }));
      return;
    }
    default:
      // `turn.accepted` and other introspection events are not surfaced
      // yet — the consumer can wire them by extending applyEvent.
      return;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
