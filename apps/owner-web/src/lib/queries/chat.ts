'use client';

import { useCallback, useRef, useState } from 'react';
import type { CeoModeId } from '@/lib/ceo-modes';
import { streamSse } from '@/lib/sse-stream';
import type {
  ChatBreadcrumb,
  ChatEvidence,
  ChatMessage,
} from '@/lib/types/chat';

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
 * Hook that owns the Master Brain chat transcript and the SSE stream
 * against `POST /api/v1/mining/chat`.
 *
 * Live-only: when the gateway stream fails or returns no events, the
 * hook surfaces an error in `state.error`. The UI is expected to
 * render an empty-state when no messages have been received yet.
 */
export function useChatSession(): {
  readonly state: ChatState;
  readonly send: (opts: SendOptions) => Promise<void>;
  readonly abort: () => void;
  readonly resetTranscript: () => void;
} {
  const [state, setState] = useState<ChatState>({
    messages: [],
    evidence: [],
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
      evidence: [],
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
      let sawAny = false;

      try {
        for await (const ev of streamSse({
          path: '/api/v1/mining/chat',
          body: { message: trimmed, mode, language: 'sw' },
          signal: controller.signal,
        })) {
          sawAny = true;
          const event = normaliseLiveEvent(ev.event);
          const data = remapLiveData(ev.event, ev.data);
          applyEvent(
            event,
            data,
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

        if (!sawAny) {
          throw new Error('chat stream returned no events');
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
