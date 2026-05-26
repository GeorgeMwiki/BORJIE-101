'use client';

import { useCallback, useRef, useState } from 'react';
import type { CeoModeId } from '@/lib/ceo-modes';
import { streamSse } from '@/lib/sse-stream';
import {
  MOCK_EVIDENCE_LIBRARY,
  SAMPLE_TRANSCRIPT,
  mockChatStream,
  type ChatBreadcrumb,
  type ChatEvidence,
  type ChatMessage,
} from '@/lib/mocks/chat';

export interface ChatState {
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly evidence: ReadonlyArray<ChatEvidence>;
  readonly streaming: boolean;
  readonly streamingText: string;
  readonly streamingBreadcrumbs: ReadonlyArray<ChatBreadcrumb>;
  readonly error: string | null;
}

export interface SendOptions {
  readonly content: string;
  readonly mode: CeoModeId;
}

/**
 * Hook that owns the Master Brain chat transcript and the SSE stream.
 *
 * Always returns immutable arrays — never mutates state in place. Falls
 * back to a simulated SSE stream when the gateway is unreachable.
 */
export function useChatSession(): {
  readonly state: ChatState;
  readonly send: (opts: SendOptions) => Promise<void>;
  readonly abort: () => void;
  readonly resetTranscript: () => void;
} {
  const [state, setState] = useState<ChatState>({
    messages: SAMPLE_TRANSCRIPT,
    evidence: MOCK_EVIDENCE_LIBRARY,
    streaming: false,
    streamingText: '',
    streamingBreadcrumbs: [],
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  const abort = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((prev) => ({ ...prev, streaming: false }));
  }, []);

  const resetTranscript = useCallback((): void => {
    abort();
    setState({
      messages: [],
      evidence: MOCK_EVIDENCE_LIBRARY,
      streaming: false,
      streamingText: '',
      streamingBreadcrumbs: [],
      error: null,
    });
  }, [abort]);

  const send = useCallback(
    async ({ content, mode }: SendOptions): Promise<void> => {
      const trimmed = content.trim();
      if (!trimmed) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const ownerMessage: ChatMessage = {
        id: `msg_${Date.now()}_o`,
        role: 'owner',
        content: trimmed,
        evidenceIds: [],
        breadcrumbs: [],
        mode,
        createdAt: new Date().toISOString(),
      };
      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, ownerMessage],
        streaming: true,
        streamingText: '',
        streamingBreadcrumbs: [],
        error: null,
      }));

      let acc = '';
      const breadcrumbs: ChatBreadcrumb[] = [];
      let evidenceIds: ReadonlyArray<string> = [];

      try {
        const liveOk = await tryLiveStream(
          { content: trimmed, mode },
          controller.signal,
          (event, payload) => {
            const handled = applyEvent(
              event,
              payload,
              (text) => {
                acc += text;
                setState((prev) => ({ ...prev, streamingText: acc }));
              },
              (bc) => {
                breadcrumbs.push(bc);
                setState((prev) => ({
                  ...prev,
                  streamingBreadcrumbs: [...prev.streamingBreadcrumbs, bc],
                }));
              },
              (ids) => {
                evidenceIds = ids;
              },
            );
            return handled;
          },
        );

        if (!liveOk) {
          for await (const ev of mockChatStream(trimmed, mode)) {
            if (controller.signal.aborted) return;
            applyEvent(
              ev.event,
              ev.data,
              (text) => {
                acc += text;
                setState((prev) => ({ ...prev, streamingText: acc }));
              },
              (bc) => {
                breadcrumbs.push(bc);
                setState((prev) => ({
                  ...prev,
                  streamingBreadcrumbs: [...prev.streamingBreadcrumbs, bc],
                }));
              },
              (ids) => {
                evidenceIds = ids;
              },
            );
          }
        }

        const brainMessage: ChatMessage = {
          id: `msg_${Date.now()}_b`,
          role: 'master-brain',
          content: acc || '…',
          evidenceIds,
          breadcrumbs,
          mode,
          createdAt: new Date().toISOString(),
        };
        setState((prev) => ({
          ...prev,
          messages: [...prev.messages, brainMessage],
          streaming: false,
          streamingText: '',
          streamingBreadcrumbs: [],
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'chat stream failed';
        setState((prev) => ({
          ...prev,
          streaming: false,
          error: message,
        }));
      }
    },
    [],
  );

  return { state, send, abort, resetTranscript };
}

function applyEvent(
  event: string,
  payload: unknown,
  onDelta: (text: string) => void,
  onBreadcrumb: (bc: ChatBreadcrumb) => void,
  onEvidence: (ids: ReadonlyArray<string>) => void,
): boolean {
  if (event === 'delta' && isRecord(payload) && typeof payload.text === 'string') {
    onDelta(payload.text);
    return true;
  }
  if (event === 'breadcrumb' && isRecord(payload)) {
    onBreadcrumb({
      agent: String(payload.agent ?? 'agent'),
      action: String(payload.action ?? 'run'),
      latencyMs: Number(payload.latencyMs ?? 0),
    });
    return true;
  }
  if (event === 'evidence' && isRecord(payload) && Array.isArray(payload.ids)) {
    onEvidence(payload.ids.map(String));
    return true;
  }
  return event === 'done';
}

async function tryLiveStream(
  body: { readonly content: string; readonly mode: CeoModeId },
  signal: AbortSignal,
  onEvent: (event: string, data: unknown) => boolean,
): Promise<boolean> {
  try {
    let sawAny = false;
    for await (const ev of streamSse({
      path: '/api/v1/mining/chat',
      // Gateway expects `message` not `content`; mode is forwarded verbatim
      // and language defaults to `sw` for owner-web (Tanzanian users).
      body: { message: body.content, mode: body.mode, language: 'sw' },
      signal,
    })) {
      sawAny = true;
      // Gateway event names diverge from the legacy mock stream — adapt
      // them here so the applyEvent switch can stay simple.
      const event = normaliseLiveEvent(ev.event);
      const data = remapLiveData(ev.event, ev.data);
      onEvent(event, data);
    }
    return sawAny;
  } catch {
    return false;
  }
}

function normaliseLiveEvent(name: string): string {
  if (name === 'message_chunks') return 'delta';
  if (name === 'junior_calls' || name === 'junior_call') return 'breadcrumb';
  if (name === 'evidence_ids' || name === 'evidence_id') return 'evidence';
  return name;
}

function remapLiveData(name: string, data: unknown): unknown {
  if (!isRecord(data)) return data;
  if (name === 'message_chunks') {
    return { text: typeof data.chunk === 'string' ? data.chunk : '' };
  }
  if (name === 'junior_calls' && Array.isArray(data.calls) && data.calls.length > 0) {
    const first = data.calls[0];
    return isRecord(first) ? first : data;
  }
  if (name === 'evidence_ids') {
    return { ids: Array.isArray(data.ids) ? data.ids : [] };
  }
  return data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
