/**
 * useBorjieChat — SSE chat hook for FloatingAskBorjie.
 *
 * Wraps the streamed turn endpoint (mining/chat for authenticated, or
 * public/chat for the marketing surface) and parses the SSE wire frames
 * documented in services/api-gateway/src/routes/mining/_openapi/chat-schemas.ts:
 *
 *   - turn.accepted     turn context acknowledgement
 *   - junior_call       junior dispatch breadcrumb chips
 *   - message_chunk     streamed answer chunks (+ evidence ids)
 *   - done              terminator
 *   - error             soft / fatal error
 *
 * Immutable state updates (no in-place mutation).
 */
import { useCallback, useRef, useState } from 'react';

export type BorjieMode =
  | 'build'
  | 'strategy'
  | 'operations'
  | 'document'
  | 'finance'
  | 'risk'
  | 'board-investor'
  | 'compliance';

export type BorjieLanguage = 'en' | 'sw';

export type BorjieRole = 'user' | 'assistant' | 'system';

export interface BorjieJuniorCall {
  readonly junior: string;
  readonly intent: string;
  readonly status: string;
  readonly evidenceIds: readonly string[];
  readonly confidence: number | null;
  readonly error: string | null;
}

export interface BorjieMessage {
  readonly id: string;
  readonly role: BorjieRole;
  readonly text: string;
  readonly evidenceIds: readonly string[];
  readonly juniorCalls: readonly BorjieJuniorCall[];
  readonly streaming: boolean;
  readonly errored: boolean;
}

export interface BorjieSendOptions {
  readonly mode: BorjieMode;
  readonly language: BorjieLanguage;
  readonly accessToken?: string | null;
}

export interface UseBorjieChatOptions {
  readonly endpoint: string;
  readonly initialMessages?: readonly BorjieMessage[];
}

export interface UseBorjieChatResult {
  readonly messages: readonly BorjieMessage[];
  readonly isStreaming: boolean;
  readonly error: string | null;
  readonly send: (query: string, opts: BorjieSendOptions) => Promise<void>;
  readonly reset: () => void;
}

interface SseFrame {
  readonly event: string;
  readonly data: string;
}

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseFrames(buffer: string): { readonly frames: readonly SseFrame[]; readonly rest: string } {
  const out: SseFrame[] = [];
  const chunks = buffer.split('\n\n');
  const rest = chunks.pop() ?? '';
  for (const chunk of chunks) {
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length > 0) out.push({ event, data: dataLines.join('\n') });
  }
  return { frames: out, rest };
}

export function useBorjieChat(opts: UseBorjieChatOptions): UseBorjieChatResult {
  const [messages, setMessages] = useState<readonly BorjieMessage[]>(opts.initialMessages ?? []);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setIsStreaming(false);
    setError(null);
  }, []);

  const send = useCallback(
    async (query: string, sendOpts: BorjieSendOptions): Promise<void> => {
      const trimmed = query.trim();
      if (!trimmed || isStreaming) return;

      const userMsg: BorjieMessage = {
        id: genId(),
        role: 'user',
        text: trimmed,
        evidenceIds: [],
        juniorCalls: [],
        streaming: false,
        errored: false,
      };
      const assistantId = genId();
      const assistantMsg: BorjieMessage = {
        id: assistantId,
        role: 'assistant',
        text: '',
        evidenceIds: [],
        juniorCalls: [],
        streaming: true,
        errored: false,
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);
      setError(null);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        };
        if (sendOpts.accessToken) headers.Authorization = `Bearer ${sendOpts.accessToken}`;

        const res = await fetch(opts.endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            mode: sendOpts.mode,
            query: trimmed,
            message: trimmed,
            language: sendOpts.language,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const txt = res.status === 401 ? 'unauthenticated' : `http_${res.status}`;
          throw new Error(txt);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { frames, rest } = parseFrames(buffer);
          buffer = rest;
          for (const frame of frames) {
            applyFrame(setMessages, assistantId, frame);
          }
        }

        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'stream_failed';
        setError(msg);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false, errored: true } : m,
          ),
        );
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [opts.endpoint, isStreaming],
  );

  return { messages, isStreaming, error, send, reset };
}

function applyFrame(
  setMessages: React.Dispatch<React.SetStateAction<readonly BorjieMessage[]>>,
  assistantId: string,
  frame: SseFrame,
): void {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = frame.data ? JSON.parse(frame.data) : {};
  } catch {
    return;
  }

  if (frame.event === 'message_chunk') {
    const chunk = typeof parsed.text === 'string' ? parsed.text : '';
    const evidence = Array.isArray(parsed.evidence_ids) ? (parsed.evidence_ids as string[]) : [];
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId
          ? {
              ...m,
              text: m.text + chunk,
              evidenceIds: evidence.length > 0 ? evidence : m.evidenceIds,
            }
          : m,
      ),
    );
    return;
  }

  if (frame.event === 'junior_call') {
    const call: BorjieJuniorCall = {
      junior: String(parsed.junior ?? ''),
      intent: String(parsed.intent ?? ''),
      status: String(parsed.status ?? ''),
      evidenceIds: Array.isArray(parsed.evidence_ids) ? (parsed.evidence_ids as string[]) : [],
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
      error: typeof parsed.error === 'string' ? parsed.error : null,
    };
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId ? { ...m, juniorCalls: [...m.juniorCalls, call] } : m,
      ),
    );
    return;
  }

  if (frame.event === 'error') {
    const errMsg = typeof parsed.message === 'string' ? parsed.message : 'orchestrator_error';
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId
          ? { ...m, errored: true, text: m.text ? `${m.text}\n\n${errMsg}` : errMsg }
          : m,
      ),
    );
  }
}
