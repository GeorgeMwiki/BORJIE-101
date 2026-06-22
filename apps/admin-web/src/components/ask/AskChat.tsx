'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send, Sparkles, RotateCcw } from 'lucide-react';

import { useChatScroll, JumpToLatestPill, AIMessageText } from '@borjie/chat-ui';
import { readSseStream, type SseEvent } from '@/lib/sse';
import { getCsrfHeaders } from '@/lib/csrf';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import {
  DEFAULT_SLICE,
  SliceSelector,
  formatSliceHint,
  type SliceState,
} from '@/components/ask/SliceSelector';

/**
 * AskChat — the industry-observer conversation surface.
 *
 * Copy is in observer/plural voice only. Chat bubbles lean institutional:
 * Fraunces for the hero / assistant openers, Geist for the body. Every
 * assistant claim is grounded in DP-aggregated platform data, so the
 * placeholder text quietly reminds the operator the slice is auditable.
 *
 * The transport is `fetch()` + `ReadableStream` (EventSource cannot POST).
 * All state updates are immutable — messages and artifacts are replaced,
 * never mutated in place.
 */

interface ChatMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly createdAt: number;
  readonly streaming?: boolean;
}

interface Artifact {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly payload: unknown;
}

type Failure =
  | { readonly kind: 'none' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'offline' }
  | { readonly kind: 'budget-exhausted'; readonly resetLabel?: string }
  | { readonly kind: 'unexpected'; readonly status: number };

interface AskChatProps {
  readonly threadId: string | null;
  readonly initialMessages?: ReadonlyArray<ChatMessage>;
  readonly initialArtifacts?: ReadonlyArray<Artifact>;
  /**
   * Server-resolved `borjie_locale` cookie, threaded from the route's
   * Server Component. SEEDS the first paint so SSR + the first client
   * render agree with the `<html lang>` the root layout stamped — without
   * it `useLocale` defaults to `en` and renders an EN chat under SW chrome
   * for one frame (the zero-mix split-brain the canon forbids).
   */
  readonly initialLocale?: Locale;
}

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '') + Date.now().toString(36);
}

async function extractFailure(res: Response): Promise<Failure> {
  if (res.status === 401) {
    return { kind: 'forbidden' };
  }
  if (res.status === 503) {
    return { kind: 'offline' };
  }
  if (res.status === 403) {
    try {
      const body = (await res.json()) as {
        readonly code?: string;
        readonly resetLabel?: string;
      };
      if (body.code === 'PLATFORM_BUDGET_EXHAUSTED') {
        return {
          kind: 'budget-exhausted',
          ...(body.resetLabel !== undefined ? { resetLabel: body.resetLabel } : {}),
        };
      }
    } catch {
      /* fall through */
    }
    return { kind: 'forbidden' };
  }
  return { kind: 'unexpected', status: res.status };
}

export function AskChat({
  threadId: initialThreadId,
  initialMessages = [],
  initialArtifacts = [],
  initialLocale,
}: AskChatProps) {
  const router = useRouter();
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [messages, setMessages] = useState<ReadonlyArray<ChatMessage>>(initialMessages);
  const [artifacts, setArtifacts] = useState<ReadonlyArray<Artifact>>(initialArtifacts);
  const [input, setInput] = useState('');
  const [slice, setSlice] = useState<SliceState>(DEFAULT_SLICE);
  const [extendedThinking, setExtendedThinking] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<Failure>({ kind: 'none' });
  const abortRef = useRef<AbortController | null>(null);
  const locale = useLocale(initialLocale);

  // Anchor-law scroll (shared hook): re-anchors on content growth only while
  // the user is at the bottom, so a tall streamed answer never yanks its own
  // tail off-screen. Replaces the smooth-scrollTo-on-[messages] effect that
  // never fired DURING a stream.
  const { scrollRef, showJumpPill, jumpToLatest, resetAtStreamStart } =
    useChatScroll();
  const retryLabel = pickByLocale(locale, { en: 'Retry', sw: 'Jaribu tena' });

  const canSend = useMemo(
    () => input.trim().length > 0 && !sending,
    [input, sending],
  );

  const dispatchEvent = useCallback(
    (streamingId: string, event: SseEvent) => {
      if (event.event === 'assistant.delta') {
        try {
          const { text } = JSON.parse(event.data) as { text?: string };
          if (typeof text === 'string' && text.length > 0) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamingId ? { ...m, text: m.text + text } : m,
              ),
            );
          }
        } catch (error) {
          console.error('assistant.delta parse failed:', error);
        }
        return;
      }
      if (event.event === 'assistant.complete') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamingId ? { ...m, streaming: false } : m,
          ),
        );
        return;
      }
      if (event.event === 'artifact') {
        try {
          const artifact = JSON.parse(event.data) as Artifact;
          setArtifacts((prev) => [...prev, artifact]);
        } catch (error) {
          console.error('artifact parse failed:', error);
        }
        return;
      }
      if (event.event === 'error') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamingId
              ? {
                  ...m,
                  text:
                    m.text +
                    '\n\n[Stream error — the industry voice dropped. Retry.]',
                  streaming: false,
                }
              : m,
          ),
        );
      }
    },
    [],
  );

  const send = useCallback(async () => {
    if (!canSend) return;
    const trimmed = input.trim();
    const hint = formatSliceHint(slice);
    const body = `${trimmed}\n\n${hint}`;

    setSending(true);
    setFailure({ kind: 'none' });
    // Re-engage auto-follow at the top of the new turn.
    resetAtStreamStart();

    const userMessage: ChatMessage = {
      id: newId(),
      role: 'user',
      text: body,
      createdAt: Date.now(),
    };
    const streamingId = newId();
    const assistantPlaceholder: ChatMessage = {
      id: streamingId,
      role: 'assistant',
      text: '',
      createdAt: Date.now(),
      streaming: true,
    };
    setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
    setInput('');

    let activeThreadId = threadId;

    try {
      if (!activeThreadId) {
        const createRes = await fetch('/api/platform/intelligence/thread', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', ...getCsrfHeaders() },
          body: JSON.stringify({
            scope: 'platform',
            persona: 'industry-observer',
          }),
        });
        if (!createRes.ok) {
          setFailure(await extractFailure(createRes));
          setMessages((prev) => prev.filter((m) => m.id !== streamingId));
          return;
        }
        const created = (await createRes.json()) as { readonly id?: string };
        if (!created.id) {
          setFailure({ kind: 'unexpected', status: 200 });
          setMessages((prev) => prev.filter((m) => m.id !== streamingId));
          return;
        }
        activeThreadId = created.id;
        setThreadId(activeThreadId);
        router.replace(`/ask/${activeThreadId}`);
      }

      const controller = new AbortController();
      abortRef.current = controller;

      const resp = await fetch(
        `/api/platform/intelligence/thread/${activeThreadId}/message`,
        {
          method: 'POST',
          credentials: 'same-origin',
          signal: controller.signal,
          headers: { 'content-type': 'application/json', ...getCsrfHeaders() },
          body: JSON.stringify({
            scope: 'platform',
            persona: 'industry-observer',
            message: body,
            // Forward the active locale so the gateway pins the reply to it —
            // without this the kernel collapses to 'en' and a Swahili operator
            // always gets English back.
            language: locale,
            extendedThinking,
            slice,
          }),
        },
      );

      if (!resp.ok || !resp.body) {
        setFailure(await extractFailure(resp));
        setMessages((prev) => prev.filter((m) => m.id !== streamingId));
        return;
      }

      await readSseStream(
        resp.body,
        (event) => dispatchEvent(streamingId, event),
        controller.signal,
      );
    } catch (error) {
      console.error('Industry stream failed:', error);
      setFailure({ kind: 'offline' });
      setMessages((prev) => prev.filter((m) => m.id !== streamingId));
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }, [
    canSend,
    dispatchEvent,
    extendedThinking,
    input,
    router,
    slice,
    threadId,
    resetAtStreamStart,
  ]);

  const retry = useCallback(() => {
    setFailure({ kind: 'none' });
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex flex-1 flex-col overflow-hidden">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-8 py-10"
      >
        {messages.length === 0 ? <EmptyState language={locale} /> : null}

        <div className="mx-auto max-w-3xl space-y-6">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} language={locale} />
          ))}

          {failure.kind === 'offline' ? (
            <FailureBanner
              title={pickByLocale(locale, {
                en: 'The industry voice is offline.',
                sw: 'Sauti ya sekta haipatikani.',
              })}
              body={pickByLocale(locale, {
                en: 'The intelligence service returned 503. No mock response will be rendered.',
                sw: 'Huduma ya akili ilirudisha 503. Hakuna jibu bandia litakaloonyeshwa.',
              })}
              action={{ label: retryLabel, onClick: retry }}
            />
          ) : null}

          {failure.kind === 'forbidden' ? (
            <FailureBanner
              title={pickByLocale(locale, {
                en: 'This conversation is platform-only.',
                sw: 'Mazungumzo haya ni ya jukwaa pekee.',
              })}
              body={pickByLocale(locale, {
                en: 'You need PLATFORM_ADMIN to query the industry observer.',
                sw: 'Unahitaji PLATFORM_ADMIN kuuliza mtazamaji wa sekta.',
              })}
            />
          ) : null}

          {failure.kind === 'budget-exhausted' ? (
            <FailureBanner
              title={pickByLocale(locale, {
                en: "We've spent this month's privacy budget.",
                sw: 'Tumetumia bajeti ya faragha ya mwezi huu.',
              })}
              body={
                failure.resetLabel
                  ? pickByLocale(locale, {
                      en: `Next reset: ${failure.resetLabel}.`,
                      sw: `Kuanzishwa upya kunakofuata: ${failure.resetLabel}.`,
                    })
                  : pickByLocale(locale, {
                      en: 'The DP-accountant will publish the next reset window shortly.',
                      sw: 'Mhasibu wa DP atachapisha dirisha la kuanzishwa upya hivi karibuni.',
                    })
              }
            />
          ) : null}

          {failure.kind === 'unexpected' ? (
            <FailureBanner
              title={pickByLocale(locale, {
                en: 'Unexpected response from the industry voice.',
                sw: 'Jibu lisilotarajiwa kutoka sauti ya sekta.',
              })}
              body={pickByLocale(locale, {
                en: `Upstream returned ${failure.status}. No answer rendered. This is deliberate.`,
                sw: `Mfumo wa juu ulirudisha ${failure.status}. Hakuna jibu lililoonyeshwa. Hii ni kwa makusudi.`,
              })}
              action={{ label: retryLabel, onClick: retry }}
            />
          ) : null}
        </div>
      </div>
        <JumpToLatestPill
          visible={showJumpPill}
          language={locale}
          onClick={jumpToLatest}
        />
      </div>

      <Composer
        input={input}
        setInput={setInput}
        slice={slice}
        setSlice={setSlice}
        extendedThinking={extendedThinking}
        setExtendedThinking={setExtendedThinking}
        canSend={canSend}
        sending={sending}
        onSend={send}
        artifactCount={artifacts.length}
        language={locale}
      />
    </div>
  );
}

function EmptyState({ language }: { readonly language: Locale }) {
  return (
    <div className="mx-auto max-w-2xl text-center py-20">
      <h2 className="font-display text-4xl text-foreground mb-4 leading-tight">
        {pickByLocale(language, {
          en: 'The network has not spoken with you today.',
          sw: 'Mtandao haujazungumza nawe leo.',
        })}
      </h2>
      <p className="text-sm text-neutral-400 leading-relaxed">
        {pickByLocale(language, {
          en: 'Ask across every tenant at once. Try:',
          sw: 'Uliza katika kila mteja kwa mara moja. Jaribu:',
        })}{' '}
        <span className="text-foreground">
          {pickByLocale(language, {
            en: '“Where is vendor reopen rate degrading?”',
            sw: '“Wapi kiwango cha kufungua upya cha wachuuzi kinashuka?”',
          })}
        </span>{' '}
        {pickByLocale(language, { en: 'or', sw: 'au' })}{' '}
        <span className="text-foreground">
          {pickByLocale(language, {
            en: '“Which jurisdictions are drifting toward tighter compliance?”',
            sw: '“Maeneo gani ya kisheria yanaelekea kwenye uzingatiaji mkali zaidi?”',
          })}
        </span>
      </p>
      <p className="mt-4 text-xs text-neutral-500">
        {pickByLocale(language, {
          en: 'Privacy is preserved. You will never see a single tenant’s name.',
          sw: 'Faragha inalindwa. Hutawahi kuona jina la mteja mmoja.',
        })}
      </p>
    </div>
  );
}

function MessageBubble({
  message,
  language,
}: {
  readonly message: ChatMessage;
  readonly language: Locale;
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-xl rounded-lg border border-border bg-surface-sunken px-4 py-3 text-sm text-foreground whitespace-pre-wrap">
          {message.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-2xl rounded-lg border border-signal-500/20 bg-surface px-5 py-4">
        <div className="flex items-center gap-2 mb-2 text-xs uppercase tracking-wider text-signal-500">
          <Sparkles className="h-3 w-3" />
          {pickByLocale(language, {
            en: 'Industry observer',
            sw: 'Mtazamaji wa sekta',
          })}
        </div>
        {message.text ? (
          // Markdown parity with the cockpit chats — bold/lists render
          // structurally instead of as literal ** / -, while the institutional
          // font-display voice is preserved via the className override.
          <AIMessageText
            content={message.text}
            className="font-display text-base leading-relaxed text-foreground break-words"
          />
        ) : (
          <div className="font-display text-base text-foreground leading-relaxed">
            {message.streaming
              ? pickByLocale(language, {
                  en: 'Listening across the network…',
                  sw: 'Inasikiliza mtandaoni…',
                })
              : ''}
          </div>
        )}
      </div>
    </div>
  );
}

function FailureBanner({
  title,
  body,
  action,
}: {
  readonly title: string;
  readonly body: string;
  readonly action?: { readonly label: string; readonly onClick: () => void };
}) {
  return (
    <div className="rounded-lg border border-warning/40 bg-warning-subtle/20 px-5 py-4">
      <div className="text-sm font-medium text-warning mb-1">{title}</div>
      <div className="text-xs text-neutral-400">{body}</div>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1 text-xs text-foreground hover:border-signal-500/40"
        >
          <RotateCcw className="h-3 w-3" />
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

interface ComposerProps {
  readonly input: string;
  readonly setInput: (v: string) => void;
  readonly slice: SliceState;
  readonly setSlice: (s: SliceState) => void;
  readonly extendedThinking: boolean;
  readonly setExtendedThinking: (v: boolean) => void;
  readonly canSend: boolean;
  readonly sending: boolean;
  readonly onSend: () => void;
  readonly artifactCount: number;
  readonly language: Locale;
}

function Composer({
  input,
  setInput,
  slice,
  setSlice,
  extendedThinking,
  setExtendedThinking,
  canSend,
  sending,
  onSend,
  artifactCount,
  language,
}: ComposerProps) {
  return (
    <div className="border-t border-border bg-surface-sunken px-6 py-4">
      <div className="mx-auto max-w-3xl space-y-3">
        <SliceSelector slice={slice} onChange={setSlice} disabled={sending} />

        <div className="flex items-end gap-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder={pickByLocale(language, {
              en: 'Ask the network about aggregate patterns…',
              sw: 'Uliza mtandao kuhusu mifumo ya jumla…',
            })}
            rows={2}
            disabled={sending}
            className="flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-neutral-500 focus:outline-none focus:border-signal-500/40 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            className="inline-flex items-center gap-1.5 rounded-md border border-signal-500/40 bg-signal-500/10 px-3 py-2 text-sm text-signal-500 hover:bg-signal-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="h-3.5 w-3.5" />
            {pickByLocale(language, { en: 'Ask', sw: 'Uliza' })}
          </button>
        </div>

        <div className="flex items-center justify-between text-xs text-neutral-500">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={extendedThinking}
              onChange={(e) => setExtendedThinking(e.target.checked)}
              disabled={sending}
              className="rounded border-border bg-surface"
            />
            {pickByLocale(language, {
              en: 'Extended thinking',
              sw: 'Kufikiri kwa kina',
            })}
          </label>
          <span>
            {artifactCount > 0
              ? pickByLocale(language, {
                  en: `${artifactCount} artifact${artifactCount === 1 ? '' : 's'} in this thread`,
                  sw: `vitu ${artifactCount} kwenye mada hii`,
                })
              : pickByLocale(language, {
                  en: 'No artifacts yet in this thread',
                  sw: 'Hakuna vitu bado kwenye mada hii',
                })}
          </span>
        </div>
      </div>
    </div>
  );
}
