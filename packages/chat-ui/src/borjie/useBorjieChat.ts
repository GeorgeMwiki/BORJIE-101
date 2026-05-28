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
 * Bilingual cache:
 *   Every message carries an `originalLang` plus a `content: Record<'en'|'sw',
 *   string>` cache. Whichever language a turn was sent or received in
 *   populates its slot; the other slot is filled on demand by calling
 *   `POST /api/v1/translate` (see translate.hono.ts). The widget never
 *   shows mixed-language history — when the user toggles, we re-render
 *   every message from `content[currentLang]` and lazily back-fill any
 *   empty slots in parallel.
 *
 * Persistence:
 *   The hook accepts a `storageKey` (default `borjie_chat_history_v1`)
 *   and rehydrates on mount, serialising the immutable message list to
 *   `localStorage` after every state change so refreshes preserve the
 *   conversation.
 *
 * Immutable state updates throughout — see the global immutability rule
 * in `~/.claude/rules/coding-style.md`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

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

/**
 * Debate metadata — populated when the server's accuracy mode runs the
 * turn through `runDebate` (fan-out across 3 providers + judge). The
 * FE renders a "Verified ✓ 3-model debate" badge above the assistant
 * bubble when `verified` is true.
 */
export interface BorjieDebateMetadata {
  readonly verified: boolean;
  readonly winner: { readonly provider: string; readonly model: string };
  readonly scores: ReadonlyArray<{
    readonly provider: string;
    readonly score: number;
    readonly reason: string;
  }>;
  readonly trace: {
    readonly judgeProvider: string | null;
    readonly winnerReason: string;
    readonly responses: ReadonlyArray<{
      readonly provider: string;
      readonly model: string;
      readonly latencyMs: number;
      readonly error?: string;
    }>;
  };
}

/**
 * Bilingual message cache. `originalLang` records the language the turn
 * was authored in (user message) or generated in (assistant); `content`
 * holds whatever translations have been resolved so far.
 */
export interface BorjieChatMessage {
  readonly id: string;
  readonly role: BorjieRole;
  readonly originalLang: BorjieLanguage;
  readonly content: Record<BorjieLanguage, string>;
  readonly evidenceIds: readonly string[];
  readonly juniorCalls: readonly BorjieJuniorCall[];
  readonly streaming: boolean;
  readonly errored: boolean;
  readonly createdAt: string;
  /** Optional 3-model debate metadata when accuracy mode ran the turn. */
  readonly debate?: BorjieDebateMetadata;
}

/**
 * Back-compat view exposed to consumers. `text` resolves to the message
 * content in the currently-active language, falling back to `originalLang`
 * (or `''` if neither slot is populated — e.g. mid-stream and the slot
 * is being filled by SSE chunks).
 */
export interface BorjieMessage extends BorjieChatMessage {
  readonly text: string;
}

export interface BorjieSendOptions {
  readonly mode: BorjieMode;
  readonly language: BorjieLanguage;
  readonly accessToken?: string | null;
}

export interface UseBorjieChatOptions {
  readonly endpoint: string;
  readonly initialMessages?: readonly BorjieChatMessage[];
  /** Current locale used to render history. When the locale changes the
   *  hook re-projects every message from `content[locale]` and lazily
   *  back-fills any empty slot via /api/v1/translate. */
  readonly locale?: BorjieLanguage;
  /** localStorage key for persisting history (default
   *  `borjie_chat_history_v1`). Pass `null` to disable persistence. */
  readonly storageKey?: string | null;
  /** Override the translate endpoint (default `/api/v1/translate`). */
  readonly translateEndpoint?: string;
  /** Override the fetch function (tests). */
  readonly fetchImpl?: typeof fetch;
}

export interface UseBorjieChatResult {
  readonly messages: readonly BorjieMessage[];
  readonly isStreaming: boolean;
  readonly error: string | null;
  readonly send: (query: string, opts: BorjieSendOptions) => Promise<void>;
  readonly reset: () => void;
  /**
   * Re-render every message in the new language and lazily back-fill any
   * empty `content[targetLang]` slot via /api/v1/translate. Safe to call
   * unconditionally on every locale change; it's a no-op when all
   * messages already have content in `targetLang`.
   */
  readonly retranslate: (targetLang: BorjieLanguage) => Promise<void>;
}

interface SseFrame {
  readonly event: string;
  readonly data: string;
}

const DEFAULT_STORAGE_KEY = 'borjie_chat_history_v1';
const DEFAULT_TRANSLATE_ENDPOINT = '/api/v1/translate';

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

function emptyContent(): Record<BorjieLanguage, string> {
  return { en: '', sw: '' };
}

function viewMessage(m: BorjieChatMessage, locale: BorjieLanguage): BorjieMessage {
  const text = m.content[locale] || m.content[m.originalLang] || '';
  return { ...m, text };
}

function isLanguageContent(v: unknown): v is Record<BorjieLanguage, string> {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.en === 'string' && typeof r.sw === 'string';
}

function normalisePersistedMessage(raw: unknown): BorjieChatMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id : genId();
  const role = r.role === 'user' || r.role === 'assistant' || r.role === 'system' ? r.role : null;
  if (!role) return null;
  const originalLang = r.originalLang === 'sw' || r.originalLang === 'en' ? r.originalLang : 'en';
  const content = isLanguageContent(r.content) ? r.content : emptyContent();
  const evidenceIds = Array.isArray(r.evidenceIds)
    ? (r.evidenceIds.filter((v) => typeof v === 'string') as string[])
    : [];
  const juniorCalls = Array.isArray(r.juniorCalls) ? (r.juniorCalls as BorjieJuniorCall[]) : [];
  const createdAt = typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString();
  return {
    id,
    role,
    originalLang,
    content,
    evidenceIds,
    juniorCalls,
    streaming: false,
    errored: false,
    createdAt,
  };
}

function safeReadStorage(key: string): readonly BorjieChatMessage[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const list = parsed.map(normalisePersistedMessage).filter(Boolean) as BorjieChatMessage[];
    return list;
  } catch {
    return null;
  }
}

function safeWriteStorage(key: string, messages: readonly BorjieChatMessage[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(messages));
  } catch {
    /* quota / private mode — silently degrade */
  }
}

export function useBorjieChat(opts: UseBorjieChatOptions): UseBorjieChatResult {
  const storageKey = opts.storageKey === null ? null : opts.storageKey ?? DEFAULT_STORAGE_KEY;
  const translateEndpoint = opts.translateEndpoint ?? DEFAULT_TRANSLATE_ENDPOINT;
  const fetchImpl =
    opts.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const initialLocale = opts.locale ?? 'en';

  const [messages, setMessages] = useState<readonly BorjieChatMessage[]>(() => {
    if (opts.initialMessages) return opts.initialMessages;
    if (storageKey) {
      const persisted = safeReadStorage(storageKey);
      if (persisted) return persisted;
    }
    return [];
  });
  const [locale, setLocale] = useState<BorjieLanguage>(initialLocale);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<readonly BorjieChatMessage[]>(messages);

  // Persist whenever messages change.
  useEffect(() => {
    messagesRef.current = messages;
    if (storageKey) safeWriteStorage(storageKey, messages);
  }, [messages, storageKey]);

  // Track locale changes from the caller.
  useEffect(() => {
    if (opts.locale && opts.locale !== locale) setLocale(opts.locale);
  }, [opts.locale, locale]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setIsStreaming(false);
    setError(null);
    if (storageKey && typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
    }
  }, [storageKey]);

  const send = useCallback(
    async (query: string, sendOpts: BorjieSendOptions): Promise<void> => {
      const trimmed = query.trim();
      if (!trimmed || isStreaming) return;

      setLocale(sendOpts.language);

      const now = new Date().toISOString();
      const userContent: Record<BorjieLanguage, string> = { ...emptyContent(), [sendOpts.language]: trimmed };
      const userMsg: BorjieChatMessage = {
        id: genId(),
        role: 'user',
        originalLang: sendOpts.language,
        content: userContent,
        evidenceIds: [],
        juniorCalls: [],
        streaming: false,
        errored: false,
        createdAt: now,
      };
      const assistantId = genId();
      const assistantMsg: BorjieChatMessage = {
        id: assistantId,
        role: 'assistant',
        originalLang: sendOpts.language,
        content: emptyContent(),
        evidenceIds: [],
        juniorCalls: [],
        streaming: true,
        errored: false,
        createdAt: now,
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

        const res = await fetchImpl(opts.endpoint, {
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
            applyFrame(setMessages, assistantId, sendOpts.language, frame);
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
    [fetchImpl, isStreaming, opts.endpoint],
  );

  const retranslate = useCallback(
    async (targetLang: BorjieLanguage): Promise<void> => {
      setLocale(targetLang);
      const current = messagesRef.current;
      const pending = current.filter(
        (m) => m.role !== 'system' && !m.content[targetLang] && m.content[m.originalLang],
      );
      if (pending.length === 0) return;

      const results = await Promise.all(
        pending.map(async (m) => {
          const sourceLang = m.originalLang;
          const text = m.content[sourceLang];
          try {
            const res = await fetchImpl(translateEndpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                text,
                from: sourceLang,
                to: targetLang,
                context: 'chat-history',
              }),
            });
            if (!res.ok) return null;
            const body = (await res.json()) as { translation?: string };
            const translation = typeof body.translation === 'string' ? body.translation : null;
            return translation ? { id: m.id, translation } : null;
          } catch {
            return null;
          }
        }),
      );

      const map = new Map<string, string>();
      for (const r of results) {
        if (r) map.set(r.id, r.translation);
      }
      if (map.size === 0) return;

      setMessages((prev) =>
        prev.map((m) => {
          const translation = map.get(m.id);
          if (!translation) return m;
          return {
            ...m,
            content: { ...m.content, [targetLang]: translation },
          };
        }),
      );
    },
    [fetchImpl, translateEndpoint],
  );

  const view = messages.map((m) => viewMessage(m, locale));

  return {
    messages: view,
    isStreaming,
    error,
    send,
    reset,
    retranslate,
  };
}

function parseDebateMetadata(raw: Record<string, unknown>): BorjieDebateMetadata | null {
  if (!raw || typeof raw !== 'object') return null;
  const winner = raw.winner;
  if (typeof winner !== 'object' || winner === null) return null;
  const w = winner as Record<string, unknown>;
  if (typeof w.provider !== 'string' || typeof w.model !== 'string') return null;
  const rawScores = Array.isArray(raw.scores) ? raw.scores : [];
  const scores: BorjieDebateMetadata['scores'] = rawScores
    .filter(
      (s): s is Record<string, unknown> =>
        typeof s === 'object' && s !== null,
    )
    .map((s) => ({
      provider: typeof s.provider === 'string' ? s.provider : '',
      score: typeof s.score === 'number' ? s.score : 0,
      reason: typeof s.reason === 'string' ? s.reason : '',
    }));
  const trace = (raw.trace ?? {}) as Record<string, unknown>;
  const rawResponses = Array.isArray(trace.responses) ? trace.responses : [];
  const responses: BorjieDebateMetadata['trace']['responses'] = rawResponses
    .filter(
      (r): r is Record<string, unknown> =>
        typeof r === 'object' && r !== null,
    )
    .map((r) => ({
      provider: typeof r.provider === 'string' ? r.provider : '',
      model: typeof r.model === 'string' ? r.model : '',
      latencyMs: typeof r.latencyMs === 'number' ? r.latencyMs : 0,
      ...(typeof r.error === 'string' ? { error: r.error } : {}),
    }));
  return {
    verified: Boolean(raw.verified),
    winner: { provider: w.provider, model: w.model },
    scores,
    trace: {
      judgeProvider:
        typeof trace.judgeProvider === 'string' ? trace.judgeProvider : null,
      winnerReason:
        typeof trace.winnerReason === 'string' ? trace.winnerReason : '',
      responses,
    },
  };
}

function applyFrame(
  setMessages: React.Dispatch<React.SetStateAction<readonly BorjieChatMessage[]>>,
  assistantId: string,
  streamLang: BorjieLanguage,
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
              content: {
                ...m.content,
                [streamLang]: (m.content[streamLang] ?? '') + chunk,
              },
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

  if (frame.event === 'debate_metadata') {
    const debate = parseDebateMetadata(parsed);
    if (!debate) return;
    setMessages((prev) =>
      prev.map((m) => (m.id === assistantId ? { ...m, debate } : m)),
    );
    return;
  }

  if (frame.event === 'error') {
    const errMsg = typeof parsed.message === 'string' ? parsed.message : 'orchestrator_error';
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId) return m;
        const existing = m.content[streamLang] ?? '';
        const combined = existing ? `${existing}\n\n${errMsg}` : errMsg;
        return {
          ...m,
          errored: true,
          content: { ...m.content, [streamLang]: combined },
        };
      }),
    );
  }
}
