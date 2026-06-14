'use client';

import { useCallback, useRef, useState } from 'react';
import type { Locale } from '@/lib/locale-shared';
import { DEFAULT_LOCALE } from '@/lib/locale-shared';
import { streamSse } from '@/lib/sse-stream';
import type {
  ChatBreadcrumb,
  ChatEvidence,
  ChatGroundingSignal,
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
}

/**
 * Hook that owns the Master Brain chat transcript and the SSE stream
 * against `POST /api/v1/mining/chat`.
 *
 * Live-only: when the gateway stream fails or returns no events, the
 * hook surfaces an error in `state.error`. The UI is expected to
 * render an empty-state when no messages have been received yet.
 */
export function useChatSession(language: Locale = DEFAULT_LOCALE): {
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
    async ({ content }: SendOptions): Promise<void> => {
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
      // KI-005 — the terminal Auditor grounding verdict for this turn, if the
      // gateway surfaced one. Stays null on legacy wires that predate the
      // `auditor` frame (the brain message simply carries no grounding badge).
      let grounding: ChatGroundingSignal | null = null;
      let sawAny = false;

      try {
        for await (const ev of streamSse({
          path: '/api/v1/mining/chat',
          body: { message: trimmed, language },
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
            (signal) => {
              grounding = signal;
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
          createdAt: new Date().toISOString(),
          // Attach the grounding verdict only when the gateway surfaced one.
          ...(grounding ? { grounding } : {}),
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
    [language],
  );

  return { state, send, abort, resetTranscript };
}

export function applyEvent(
  event: string,
  payload: unknown,
  onDelta: (text: string) => void,
  onBreadcrumb: (bc: ChatBreadcrumb) => void,
  onEvidence: (ids: ReadonlyArray<string>) => void,
  // KI-005 — optional grounding-verdict sink. Optional so existing callers
  // (and tests) that pass only the first five callbacks keep compiling.
  onAuditor?: (signal: ChatGroundingSignal) => void,
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
  // KI-005 — the terminal Auditor verdict. `remapLiveData` has already
  // projected the wire frame into a `ChatGroundingSignal`. Surface it so the
  // chat panel can render a grounding badge / warning; never withholds.
  if (event === 'auditor' && isChatGroundingSignal(payload)) {
    onAuditor?.(payload);
    return true;
  }
  return event === 'done';
}

export function normaliseLiveEvent(name: string): string {
  // The live gateway emits the SINGULAR contract names
  // (`message_chunk` / `junior_call` — see chat-schemas.ts). The plural
  // aliases are kept only for back-compat with older stream replays.
  if (name === 'message_chunk' || name === 'message_chunks') return 'delta';
  if (name === 'junior_calls' || name === 'junior_call') return 'breadcrumb';
  if (name === 'evidence_ids' || name === 'evidence_id') return 'evidence';
  // KI-005 — the gateway's terminal grounding verdict frame. Kept as its own
  // internal event (not folded into delta/breadcrumb/evidence) so the chat
  // surface can render a distinct grounding badge / warning.
  if (name === 'auditor') return 'auditor';
  return name;
}

export function remapLiveData(name: string, data: unknown): unknown {
  if (!isRecord(data)) return data;
  // Live (singular) contract — see services/api-gateway .../chat-schemas.ts:
  //   message_chunk → { text, evidence_ids, confidence, done }
  //   junior_call   → { junior, intent, status, evidence_ids, confidence }
  if (name === 'message_chunk') {
    return {
      text: typeof data.text === 'string' ? data.text : '',
      ids: Array.isArray(data.evidence_ids) ? data.evidence_ids : [],
    };
  }
  if (name === 'junior_call') {
    return {
      agent: typeof data.junior === 'string' ? data.junior : 'agent',
      action:
        typeof data.intent === 'string'
          ? data.intent
          : typeof data.status === 'string'
            ? data.status
            : 'run',
      latencyMs: 0,
    };
  }
  // KI-005 — the terminal Auditor verdict frame. The gateway writes
  // snake_case wire fields ({verdict, evidence_count, evidence_warning,
  // grounding_fault}); project them onto the camelCase `ChatGroundingSignal`
  // the chat surface consumes. Defensive defaults keep an unexpected frame
  // from crashing the stream (it degrades to an `approve`/no-warning signal).
  if (name === 'auditor') {
    const verdict =
      data.verdict === 'reject' || data.verdict === 'needs_human'
        ? data.verdict
        : 'approve';
    const evidenceWarning =
      data.evidence_warning === 'no_evidence_cited' ||
      data.evidence_warning === 'evidence_invalid'
        ? data.evidence_warning
        : null;
    const signal: ChatGroundingSignal = {
      verdict,
      evidenceCount:
        typeof data.evidence_count === 'number' ? data.evidence_count : 0,
      evidenceWarning,
      groundingFault: data.grounding_fault === true,
    };
    return signal;
  }
  // Back-compat (plural) aliases for older stream replays.
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

/**
 * KI-005 — narrow an already-remapped payload to a `ChatGroundingSignal`.
 * `remapLiveData('auditor', …)` produces exactly this camelCase shape, so the
 * guard checks the discriminating fields the renderer relies on.
 */
function isChatGroundingSignal(value: unknown): value is ChatGroundingSignal {
  return (
    isRecord(value) &&
    (value.verdict === 'approve' ||
      value.verdict === 'reject' ||
      value.verdict === 'needs_human') &&
    typeof value.evidenceCount === 'number' &&
    typeof value.groundingFault === 'boolean' &&
    (value.evidenceWarning === null ||
      value.evidenceWarning === 'no_evidence_cited' ||
      value.evidenceWarning === 'evidence_invalid')
  );
}
