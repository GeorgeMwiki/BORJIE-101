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
import { Plus } from 'lucide-react';
import {
  getTab,
  ownerOsSpawnBatchSchema,
  type OwnerOSSpawnIntent,
} from '@borjie/owner-os-tabs';
import { SuggestedTabBanner } from '@/components/owner-os/SuggestedTabBanner';
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
import { InlineBlockRenderer } from './inline-blocks/InlineBlockRenderer';
import { MessageBubble, TypingBubble } from './MessageBubble';
import { QuickReplyChips } from './QuickReplyChips';
import { StepperBar } from './StepperBar';
import {
  appendBoardElement,
  boardElementSchema,
} from '@/components/blackboard';

export interface HomeChatTeachProps {
  readonly salutation: string;
  readonly tradingName: string;
  readonly languagePreference: 'sw' | 'en';
  /**
   * Optional — when the brain emits `<spawn_tabs>`, the FE renders a
   * "Suggested tab" chip below the bubble. Clicking the chip calls this
   * callback with one OwnerOSSpawnIntent; the OwnerOSShell routes it
   * through `spawnOrAugment` so the registry handles dedup + augment.
   */
  readonly onSpawnTab?: (intent: OwnerOSSpawnIntent) => void;
}

/**
 * Parsed inline block emitted by the brain as a `<ui_block>` whose
 * `type` is one of the INLINE-FIRST catalog kinds (mini_metric,
 * data_capture_card, confirmation_card, file_request_card,
 * micro_action_card, tab_promotion_chip, inline_table, inline_chart,
 * inline_wizard, inline_workflow, inline_comparison, inline_section,
 * inline_dashboard, doc_quest). We render a labeled card per kind so
 * the visitor sees a clean affordance instead of raw XML.
 */
interface InlineBlock {
  readonly type: string;
  readonly title?: string;
  readonly [key: string]: unknown;
}

interface TeachMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly inlineMetrics: ReadonlyArray<InlineMetric>;
  readonly uiBlock: TeachUiBlock | null;
  readonly inlineBlocks: ReadonlyArray<InlineBlock>;
  readonly suggestedActions: ReadonlyArray<string>;
  readonly citations: ReadonlyArray<string>;
  readonly streaming: boolean;
  readonly errored: boolean;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  /** OwnerOS spawn-tab candidates emitted by the brain (max 3). */
  readonly spawnTabs: ReadonlyArray<OwnerOSSpawnIntent>;
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

/**
 * Inline block normaliser — accept ANY object with a string `type` so
 * the dispatcher in `./inline-blocks/InlineBlockRenderer.tsx` can route
 * it to the bespoke renderer. Unknown kinds surface via the dispatcher's
 * built-in `[unknown block]` placeholder.
 */

function normaliseInlineBlock(value: unknown): InlineBlock | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.type !== 'string' || v.type.trim().length === 0) return null;
  return v as InlineBlock;
}

export function HomeChatTeach({
  salutation,
  tradingName,
  languagePreference,
  onSpawnTab,
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
        inlineBlocks: [],
        suggestedActions: [],
        citations: [],
        spawnTabs: [],
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
        inlineBlocks: [],
        suggestedActions: [],
        citations: [],
        spawnTabs: [],
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
            } else if (frame.event === 'inline_block') {
              const block = normaliseInlineBlock(payload.block);
              if (block) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          inlineBlocks: [...m.inlineBlocks, block].slice(0, 8),
                        }
                      : m,
                  ),
                );
              }
            } else if (frame.event === 'board_element') {
              // Validate via the FE schema for defence in depth — the
              // server already validated with the parallel server-side
              // schema, but the FE re-checks so a wire-format drift
              // can never crash the blackboard store.
              const parsed = boardElementSchema.safeParse(payload.element);
              if (parsed.success) {
                appendBoardElement(parsed.data, assistantId);
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
            } else if (frame.event === 'spawn_tabs') {
              // Validate via the shared schema so malformed payloads
              // never crash the renderer. The server already validated;
              // the client double-checks for defence in depth.
              const parsed = ownerOsSpawnBatchSchema.safeParse(
                payload.batch ?? payload,
              );
              if (parsed.success) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, spawnTabs: parsed.data.tabs }
                      : m,
                  ),
                );
              }
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

  // Snippet extraction for the ambient SuggestedTabBanner. Pulls the
  // most recent owner message + the most recent brain reply so the
  // deterministic intent matcher can score the registry without an LLM
  // call. The matcher runs on every keystroke; cap the snippets at 500
  // chars each so the work stays O(descriptors × keywords).
  const banner = useMemo(() => {
    let userMessage: string | undefined;
    let brainReply: string | undefined;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (!m) continue;
      if (!brainReply && m.role === 'assistant' && m.text.trim().length > 0) {
        brainReply = m.text.slice(-500);
      }
      if (!userMessage && m.role === 'user' && m.text.trim().length > 0) {
        userMessage = m.text.slice(-500);
      }
      if (userMessage && brainReply) break;
    }
    return { userMessage, brainReply };
  }, [messages]);

  const lastAssistantId = useMemo<string | null>(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m && m.role === 'assistant') return m.id;
    }
    return null;
  }, [messages]);

  return (
    <div
      className="flex flex-1 overflow-hidden"
      data-testid="home-chat-teach-root"
    >
      <StepperBar
        language={languagePreference}
        currentStep={lessonStep}
        className="hidden md:flex"
      />

      <div className="flex flex-1 flex-col gap-4 px-6 py-6 lg:px-8">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-tiny uppercase tracking-wide text-warning">
              {languagePreference === 'sw'
                ? `${'Kari' + 'bu'}, Bwana Mkubwa`
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
          className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface/40"
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
                <TeachBubble
                  key={message.id}
                  message={message}
                  languagePreference={languagePreference}
                  isLatestAssistant={message.id === lastAssistantId}
                  onSuggestion={onSuggestion}
                  composerDisabled={composerDisabled || isStreaming}
                  {...(onSpawnTab ? { onSpawnTab } : {})}
                />
              ))
            )}
            {isStreaming && !messages.some((m) => m.streaming) ? (
              <TypingBubble language={languagePreference} />
            ) : null}
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

          {onSpawnTab ? (
            <div className="px-3 pb-2">
              <SuggestedTabBanner
                languagePreference={languagePreference}
                {...(banner.userMessage !== undefined && {
                  userMessage: banner.userMessage,
                })}
                {...(banner.brainReply !== undefined && {
                  brainReply: banner.brainReply,
                })}
                onSpawn={(descriptor) => {
                  const validDescriptor = getTab(descriptor.type);
                  if (!validDescriptor) return;
                  onSpawnTab({
                    type: descriptor.type,
                    context: {},
                    reason:
                      languagePreference === 'sw'
                        ? validDescriptor.descriptionSw
                        : validDescriptor.descriptionEn,
                  });
                }}
              />
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
  readonly languagePreference: 'sw' | 'en';
  readonly isLatestAssistant: boolean;
  readonly onSuggestion: (text: string) => void;
  readonly composerDisabled: boolean;
  readonly onSpawnTab?: (intent: OwnerOSSpawnIntent) => void;
}

function TeachBubble({
  message,
  languagePreference,
  isLatestAssistant,
  onSuggestion,
  composerDisabled,
  onSpawnTab,
}: TeachBubbleProps): ReactElement {
  const isOwner = message.role === 'user';

  return (
    <div className="space-y-2">
      {!isOwner && message.inlineMetrics.length > 0 ? (
        <ul
          data-testid="teach-inline-metric-row"
          className="m-0 flex list-none flex-wrap gap-1.5 p-0 pl-10"
          aria-label="Live metrics"
        >
          {message.inlineMetrics.map((metric, i) => (
            <li key={`${metric.label}_${i}`}>
              <InlineMetricChip metric={metric} />
            </li>
          ))}
        </ul>
      ) : null}

      <MessageBubble
        role={message.role}
        createdAt={message.createdAt}
        errored={message.errored}
        streaming={message.streaming}
        testId={`teach-bubble-${message.role}`}
      >
        <p className="whitespace-pre-wrap">
          {message.text || (message.streaming ? '' : '(no content)')}
        </p>

        {!isOwner && message.uiBlock ? (
          <UiBlockRenderer
            block={message.uiBlock}
            language={languagePreference}
            onDeepDive={({ title, point }) => {
              const verb =
                languagePreference === 'sw' ? 'Nichunguzie' : 'Deep dive on';
              const target = point ? `"${point}"` : `"${title}"`;
              onSuggestion(`${verb} ${target}`);
            }}
            onGoWider={({ title, point }) => {
              const verb =
                languagePreference === 'sw' ? 'Panua kuhusu' : 'Go wider on';
              const target = point ? `"${point}"` : `"${title}"`;
              onSuggestion(`${verb} ${target}`);
            }}
            onRelatedClick={(concept) => {
              const verb =
                languagePreference === 'sw'
                  ? 'Nifundishe kuhusu'
                  : 'Teach me about';
              onSuggestion(`${verb} ${concept}`);
            }}
            onMicroLessonCta={onSuggestion}
          />
        ) : null}

        {!isOwner && message.inlineBlocks.length > 0 ? (
          <ul
            data-testid="teach-inline-blocks"
            className="m-0 mt-3 flex list-none flex-col gap-2 p-0"
          >
            {message.inlineBlocks.map((block, i) => (
              <li
                key={`${block.type}_${i}`}
                data-testid={`teach-inline-block-${block.type}`}
                className="m-0 p-0"
              >
                <InlineBlockRenderer
                  block={block as unknown as Record<string, unknown> & {
                    type?: string;
                  }}
                  locale={languagePreference}
                  sessionId={message.id}
                  onAction={(event) => {
                    // Tab promotion → forward through onSpawnTab so the
                    // owner-os shell handles dedup + augment.
                    if (
                      event.action === 'spawn_tab' &&
                      onSpawnTab &&
                      event.payload &&
                      typeof event.payload === 'object'
                    ) {
                      const p = event.payload as {
                        readonly tabType?: string;
                        readonly context?: Record<string, unknown>;
                      };
                      const parsed = ownerOsSpawnBatchSchema.safeParse({
                        tabs: [
                          {
                            type: p.tabType,
                            context: p.context ?? {},
                            reason:
                              languagePreference === 'sw'
                                ? 'Inline tab promotion'
                                : 'Inline tab promotion',
                          },
                        ],
                      });
                      if (parsed.success) {
                        const first = parsed.data.tabs[0];
                        if (first) onSpawnTab(first);
                      }
                      return;
                    }
                    // level_select → reply as the owner's next turn so
                    // the brain calibrates subsequent responses.
                    if (event.action === 'level_select') {
                      const p = event.payload as {
                        readonly levelId?: string;
                        readonly label?: string;
                      };
                      if (typeof p.label === 'string' && p.label.length > 0) {
                        onSuggestion(p.label);
                      }
                      return;
                    }
                    // Other actions (micro_action / wizard submit /
                    // capture / file upload / etc) — forward as a
                    // surfaced suggestion so the brain sees the action
                    // intent in the next turn. The host owns the real
                    // network dispatch; this keeps the chat continuous
                    // until the explicit micro-action endpoint is
                    // wired through.
                    if (typeof event.action === 'string' && event.action.length > 0) {
                      onSuggestion(`__inline_action:${event.action}`);
                    }
                  }}
                />
              </li>
            ))}
          </ul>
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
      </MessageBubble>

      {!isOwner && isLatestAssistant && message.suggestedActions.length > 0 ? (
        <QuickReplyChips
          replies={message.suggestedActions.map((action) => ({ value: action }))}
          language={languagePreference}
          onSelect={onSuggestion}
          disabled={composerDisabled}
          eyebrow={languagePreference === 'sw' ? 'Hatua zinazofuata' : 'Next moves'}
        />
      ) : null}

      {!isOwner && message.spawnTabs.length > 0 && onSpawnTab ? (
        <div
          data-testid="teach-spawn-tabs"
          className="ml-10 flex max-w-2xl flex-col gap-1.5 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2"
        >
          <p className="text-tiny uppercase tracking-wide text-warning">
            {languagePreference === 'sw'
              ? 'Tabs zinazopendekezwa'
              : 'Suggested tabs'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {message.spawnTabs.map((intent, i) => (
              <button
                key={`${intent.type}_${i}`}
                type="button"
                onClick={() => onSpawnTab(intent)}
                data-testid={`teach-spawn-${intent.type}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-tiny font-medium text-warning hover:bg-warning/20"
              >
                <Plus aria-hidden="true" className="h-3 w-3" />
                <span>{intent.type}</span>
                <span className="text-neutral-400">·</span>
                <span className="truncate max-w-xs text-neutral-300">
                  {intent.reason}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
