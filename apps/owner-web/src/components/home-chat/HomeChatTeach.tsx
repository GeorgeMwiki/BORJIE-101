'use client';

/**
 * HomeChatTeach — authenticated chat-first surface that talks to the
 * /api/v1/brain/teach SSE endpoint.
 *
 * SURPASSES LitFin's /api/chat/exploration register on five vectors —
 * see services/api-gateway/src/routes/brain-teach.hono.ts for the
 * server-side discipline. This component is the client renderer:
 *
 *   - Streams text via SSE (turn.accepted / message_chunk / ui_block /
 *     inline_metric / suggested_actions / done / error).
 *   - Renders ONE primary ui_block per assistant bubble (concept_card,
 *     metric_strip, decision_card, step_progress) via UiBlockRenderer.
 *   - Renders up to TWO inline_metric chips above the bubble.
 *   - Renders the 3 suggested action chips under the bubble; tapping a
 *     chip posts it as the next user message.
 *   - Tracks the owner's lesson step (1-5) so the server can offer
 *     "next" suggestions framed correctly.
 *   - LIVE-only: an error frame surfaces as a clear destructive notice;
 *     NO mock fallback string is ever shown.
 *
 * Independent of the existing HomeChat surface — HomeChat keeps using
 * /turn for tool-calling persona-runtime features. HomeChatTeach is the
 * lightweight teaching surface for the cockpit home.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { API_BASE, isBrainConfigured } from '@/lib/brain-api';
import { AskComposer } from '@/components/ask/AskComposer';
import {
  AskEmptyState,
  type AskEmptyKind,
} from '@/components/ask/AskEmptyState';
import { PersonaGreeting } from './PersonaGreeting';
import {
  UiBlockRenderer,
  InlineMetricChip,
  type TeachUiBlock,
  type InlineMetric,
} from './UiBlockRenderer';
import { fmtTime } from '@/lib/format';

export interface HomeChatTeachProps {
  readonly salutation: string;
  readonly tradingName: string;
  readonly languagePreference: 'sw' | 'en';
}

interface TeachMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly inlineMetrics: ReadonlyArray<InlineMetric>;
  readonly uiBlock: TeachUiBlock | null;
  readonly suggestedActions: ReadonlyArray<string>;
  readonly citations: ReadonlyArray<string>;
  readonly streaming: boolean;
  readonly errored: boolean;
  readonly errorMessage: string | null;
  readonly createdAt: string;
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

function parseFrames(buffer: string): {
  readonly frames: ReadonlyArray<SseFrame>;
  readonly rest: string;
} {
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

async function getAccessToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

function resolveEmptyKind(args: {
  readonly configured: boolean;
  readonly errored: boolean;
  readonly messageCount: number;
}): AskEmptyKind {
  if (!args.configured) return 'unconfigured';
  if (args.errored && args.messageCount === 0) return 'error';
  return 'fresh';
}

/** Map a parsed payload onto a TeachUiBlock if the type is allowed. */
function normaliseUiBlock(value: unknown): TeachUiBlock | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.type !== 'string') return null;
  return v as TeachUiBlock;
}

function normaliseInlineMetric(value: unknown): InlineMetric | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.label !== 'string' || typeof v.value !== 'string') return null;
  const tone = v.tone === 'positive' || v.tone === 'warning' ? v.tone : 'neutral';
  return { label: v.label, value: v.value, tone };
}

export function HomeChatTeach({
  salutation,
  tradingName,
  languagePreference,
}: HomeChatTeachProps): ReactElement {
  const configured = isBrainConfigured();
  const [messages, setMessages] = useState<ReadonlyArray<TeachMessage>>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [errored, setErrored] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lessonStep, setLessonStep] = useState(1);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof el.scrollTo !== 'function') return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length, isStreaming]);

  const send = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      const userMsg: TeachMessage = {
        id: genId(),
        role: 'user',
        text: trimmed,
        inlineMetrics: [],
        uiBlock: null,
        suggestedActions: [],
        citations: [],
        streaming: false,
        errored: false,
        errorMessage: null,
        createdAt: new Date().toISOString(),
      };
      const assistantId = genId();
      const assistantMsg: TeachMessage = {
        id: assistantId,
        role: 'assistant',
        text: '',
        inlineMetrics: [],
        uiBlock: null,
        suggestedActions: [],
        citations: [],
        streaming: true,
        errored: false,
        errorMessage: null,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);
      setErrored(false);
      setLastError(null);

      // Snapshot the history we send to the server BEFORE we appended
      // the new pair so the API sees the prior turns only.
      const historyPayload = messages
        .filter((m) => m.text.trim().length > 0)
        .map((m) => ({ role: m.role, text: m.text }));

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const accessToken = await getAccessToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      const endpoint = `${API_BASE.replace(/\/+$/, '')}/api/v1/brain/teach`;

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          credentials: 'include',
          signal: controller.signal,
          body: JSON.stringify({
            message: trimmed,
            history: historyPayload,
            language: languagePreference,
            step: lessonStep,
          }),
        });

        if (!res.ok || !res.body) {
          const detail =
            res.status === 401
              ? 'Your session expired. Please sign in again.'
              : `Borjie Brain returned HTTP ${res.status}.`;
          throw new Error(detail);
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
            let payload: Record<string, unknown> = {};
            try {
              payload = frame.data ? JSON.parse(frame.data) : {};
            } catch {
              continue;
            }
            if (frame.event === 'message_chunk') {
              const chunk = typeof payload.text === 'string' ? payload.text : '';
              const evidence = Array.isArray(payload.evidence_ids)
                ? (payload.evidence_ids as ReadonlyArray<unknown>).filter(
                    (x): x is string => typeof x === 'string',
                  )
                : [];
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        text: m.text + chunk,
                        citations:
                          evidence.length > 0 ? evidence : m.citations,
                      }
                    : m,
                ),
              );
            } else if (frame.event === 'ui_block') {
              const block = normaliseUiBlock(payload.block);
              if (block) {
                if (block.type === 'step_progress') {
                  const next = typeof (block as { current?: unknown }).current === 'number'
                    ? Number((block as { current?: number }).current)
                    : null;
                  if (next !== null && next >= 1 && next <= 5) {
                    setLessonStep(next);
                  }
                }
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, uiBlock: block } : m,
                  ),
                );
              }
            } else if (frame.event === 'inline_metric') {
              const metric = normaliseInlineMetric(payload.metric);
              if (metric) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          inlineMetrics: [...m.inlineMetrics, metric].slice(0, 2),
                        }
                      : m,
                  ),
                );
              }
            } else if (frame.event === 'suggested_actions') {
              const actions = Array.isArray(payload.actions)
                ? (payload.actions as ReadonlyArray<unknown>).filter(
                    (x): x is string => typeof x === 'string',
                  )
                : [];
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, suggestedActions: actions.slice(0, 3) }
                    : m,
                ),
              );
            } else if (frame.event === 'error') {
              const msg =
                typeof payload.message === 'string'
                  ? payload.message
                  : 'Borjie Brain stream errored.';
              setLastError(msg);
              setErrored(true);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        streaming: false,
                        errored: true,
                        errorMessage: msg,
                      }
                    : m,
                ),
              );
            }
            // 'done' frame has no client-side side effect beyond closing
            // the stream (handled by the loop exiting).
          }
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false } : m,
          ),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Stream failed.';
        setLastError(msg);
        setErrored(true);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  streaming: false,
                  errored: true,
                  errorMessage: msg,
                }
              : m,
          ),
        );
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [isStreaming, languagePreference, lessonStep, messages],
  );

  const onReset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setIsStreaming(false);
    setErrored(false);
    setLastError(null);
    setLessonStep(1);
  }, []);

  const emptyKind = resolveEmptyKind({
    configured,
    errored,
    messageCount: messages.length,
  });

  const composerDisabled = !configured;
  const showGreeting = messages.length === 0;

  const onSuggestion = useCallback(
    (text: string) => {
      void send(text);
    },
    [send],
  );

  const lastAssistantActions = useMemo<ReadonlyArray<string>>(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m && m.role === 'assistant' && m.suggestedActions.length > 0) {
        return m.suggestedActions;
      }
    }
    return [];
  }, [messages]);

  return (
    <div
      className="flex flex-1 overflow-hidden"
      data-testid="home-chat-teach-root"
    >
      <div className="flex flex-1 flex-col gap-4 px-6 py-6 lg:px-8">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-tiny uppercase tracking-wide text-warning">
              {languagePreference === 'sw'
                ? 'Karibu, Bwana Mkubwa'
                : 'Welcome to your cockpit'}
            </p>
            <p className="mt-0.5 text-xs text-neutral-500">
              {languagePreference === 'sw'
                ? `Mwalimu Borjie · ${tradingName} · Hatua ${lessonStep}/5`
                : `Borjie Teach · ${tradingName} · Step ${lessonStep}/5`}
            </p>
          </div>
          {messages.length > 0 ? (
            <button
              type="button"
              onClick={onReset}
              className="rounded border border-border bg-surface px-3 py-1.5 text-xs text-neutral-400 hover:bg-surface/60"
              data-testid="home-chat-teach-reset"
            >
              {languagePreference === 'sw' ? 'Mazungumzo mapya' : 'New thread'}
            </button>
          ) : null}
        </header>

        {showGreeting ? (
          <PersonaGreeting
            salutation={salutation}
            tradingName={tradingName}
            languagePreference={languagePreference}
            onSuggestion={onSuggestion}
            disabled={composerDisabled || isStreaming}
          />
        ) : null}

        <section
          className="flex flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface/40"
          aria-label="Borjie Teach transcript"
          data-testid="home-chat-teach-transcript"
        >
          <div
            ref={scrollRef}
            className="flex-1 space-y-4 overflow-y-auto px-4 py-4"
            aria-live="polite"
          >
            {messages.length === 0 ? (
              <AskEmptyState
                kind={emptyKind}
                detail={emptyKind === 'error' ? lastError : null}
              />
            ) : (
              messages.map((message) => (
                <TeachBubble key={message.id} message={message} />
              ))
            )}
            {errored && messages.length > 0 ? (
              <div
                role="alert"
                data-testid="home-chat-teach-error-inline"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {lastError ?? 'Stream errored.'}
              </div>
            ) : null}
          </div>

          {lastAssistantActions.length > 0 && !isStreaming ? (
            <div
              data-testid="home-chat-teach-actions"
              className="border-t border-border bg-surface/30 px-4 py-3"
            >
              <p className="mb-1.5 text-tiny uppercase tracking-wide text-neutral-500">
                {languagePreference === 'sw' ? 'Hatua zinazofuata' : 'Next moves'}
              </p>
              <div className="flex flex-wrap gap-2">
                {lastAssistantActions.map((action, i) => (
                  <button
                    key={`${action}_${i}`}
                    type="button"
                    onClick={() => onSuggestion(action)}
                    disabled={composerDisabled || isStreaming}
                    className="rounded-full border border-warning/40 bg-warning-subtle/10 px-3 py-1 text-tiny font-medium text-warning hover:bg-warning-subtle/20 disabled:opacity-50"
                  >
                    {action}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <AskComposer
            busy={isStreaming}
            disabled={composerDisabled}
            onSubmit={(content) => void send(content)}
          />
        </section>
      </div>
    </div>
  );
}

interface TeachBubbleProps {
  readonly message: TeachMessage;
}

function TeachBubble({ message }: TeachBubbleProps): ReactElement {
  const isOwner = message.role === 'user';
  return (
    <div
      data-testid={`teach-bubble-${message.role}`}
      data-streaming={message.streaming || undefined}
      className={`flex flex-col gap-1 ${isOwner ? '' : 'items-end'}`}
    >
      <div className="text-badge text-neutral-500">
        {isOwner ? 'Owner' : 'Borjie Teach'} · {fmtTime(message.createdAt)}
      </div>

      {!isOwner && message.inlineMetrics.length > 0 ? (
        <ul
          data-testid="teach-inline-metric-row"
          className="m-0 flex max-w-2xl list-none flex-wrap gap-1.5 p-0"
          aria-label="Live metrics"
        >
          {message.inlineMetrics.map((metric, i) => (
            <li key={`${metric.label}_${i}`}>
              <InlineMetricChip metric={metric} />
            </li>
          ))}
        </ul>
      ) : null}

      <div
        className={`max-w-2xl rounded-lg px-3 py-2 text-sm leading-relaxed ${
          isOwner
            ? 'bg-surface text-foreground'
            : `border ${message.errored ? 'border-destructive/40 bg-destructive/10' : 'border-warning/40 bg-warning-subtle/20'} text-foreground`
        }`}
      >
        <p className="whitespace-pre-wrap">
          {message.text || (message.streaming ? '' : '(no content)')}
          {message.streaming ? (
            <span
              aria-hidden="true"
              data-testid="teach-stream-cursor"
              className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-warning align-text-bottom"
            />
          ) : null}
        </p>

        {!isOwner && message.uiBlock ? (
          <UiBlockRenderer block={message.uiBlock} />
        ) : null}

        {!isOwner && message.citations.length > 0 ? (
          <div
            className="mt-2 flex flex-wrap gap-1.5"
            data-testid="teach-citations"
          >
            {message.citations.map((id) => (
              <span
                key={id}
                className="rounded-full border border-info/40 bg-info/10 px-2 py-0.5 text-tiny font-medium text-info"
              >
                {id.replace(/^borjie:/, '')}
              </span>
            ))}
          </div>
        ) : null}

        {!isOwner && message.errored && message.errorMessage ? (
          <p className="mt-2 text-tiny text-destructive">
            {message.errorMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}
