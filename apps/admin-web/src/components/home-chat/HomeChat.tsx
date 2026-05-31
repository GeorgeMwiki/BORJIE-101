'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Send, Square, RotateCcw, Sparkles } from 'lucide-react';

import { ApiError, isBrainConfigured } from '@/lib/brain-api';
import {
  useAskBorjie,
  type AskBorjieMessage,
} from '@/lib/queries/brain';
import { QueryProvider } from '@/components/internal/QueryProvider';
import {
  AdminSuperpowerChips,
  useAdminChipEmissions,
} from '@/components/superpowers';
import { PersonaGreeting } from './PersonaGreeting';
import { ToolCallSidebar } from './ToolCallSidebar';

/**
 * HomeChat — the chat-first home for Borjie HQ operators.
 *
 * Layout: a single full-bleed surface. Left column is the transcript +
 * composer; right column (lg+) is the ToolCallSidebar that surfaces the
 * juniors invoked on the most recent turn. Empty state renders the
 * PersonaGreeting with four high-leverage suggestion chips that seed the
 * composer.
 *
 * Streaming: the `/brain/turn` route returns a single JSON envelope, so
 * `useAskBorjie` yields one terminal chunk per turn. The bubble layer
 * still renders a faux streaming cursor while the request is in flight
 * so the operator gets the same feel as the owner cockpit.
 *
 * Persona: every turn is forced to `T2_admin_strategist` inside
 * `useAskBorjie`. Admin sees data across every tenant.
 *
 * Auth: this component assumes the server-side gate already confirmed a
 * Supabase session. Network 401s still flow through `ApiError` so the
 * sign-in nudge stays consistent.
 */

function HomeChatInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialThreadId = searchParams?.get('thread') ?? null;
  const configured = isBrainConfigured();

  const handleThreadCreated = useCallback(
    (threadId: string) => {
      if (typeof window === 'undefined') return;
      const url = new URL(window.location.href);
      if (url.searchParams.get('thread') === threadId) return;
      url.searchParams.set('thread', threadId);
      router.replace(`${url.pathname}${url.search}`, { scroll: false });
    },
    [router],
  );

  const {
    threadId,
    messages,
    latestToolCalls,
    isStreaming,
    isHydrating,
    error,
    send,
    reset,
  } = useAskBorjie({
    initialThreadId,
    onThreadCreated: handleThreadCreated,
  });

  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof el.scrollTo !== 'function') return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length, isStreaming]);

  const submitDraft = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;
      void send(trimmed);
      setDraft('');
    },
    [isStreaming, send],
  );

  const onFormSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      submitDraft(draft);
    },
    [draft, submitDraft],
  );

  const onTextareaKey = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitDraft(draft);
      }
    },
    [draft, submitDraft],
  );

  const onChipClick = useCallback(
    (prompt: string) => {
      if (isStreaming || !configured) return;
      submitDraft(prompt);
    },
    [configured, isStreaming, submitDraft],
  );

  const onNewThread = useCallback(() => {
    reset();
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.delete('thread');
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }, [reset, router]);

  const showEmpty = messages.length === 0;
  const aggregateCitations = messages
    .filter((m) => m.role === 'assistant')
    .flatMap((m) => m.citations);

  return (
    <div className="flex h-screen w-full flex-row bg-background text-foreground">
      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-3 border-b border-border bg-surface/40 px-6 py-3">
          <div className="flex items-center gap-2">
            <Sparkles
              className="h-4 w-4 text-signal-500"
              aria-hidden="true"
            />
            <h1 className="font-display text-lg text-foreground">
              Borjie internal — chat home
            </h1>
            {threadId ? (
              <code
                data-testid="home-chat-thread-id"
                className="rounded bg-surface px-1.5 py-0.5 font-mono text-tiny text-neutral-400"
              >
                {threadId.slice(0, 8)}
              </code>
            ) : null}
          </div>
          {messages.length > 0 ? (
            <button
              type="button"
              onClick={onNewThread}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-neutral-400 hover:border-signal-500/40 hover:text-foreground"
              data-testid="home-chat-reset"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              New thread
            </button>
          ) : null}
        </header>

        <section
          ref={scrollRef}
          className="flex-1 overflow-y-auto"
          aria-live="polite"
          data-testid="home-chat-transcript"
        >
          {showEmpty ? (
            <PersonaGreeting
              onSuggest={onChipClick}
              disabled={!configured || isStreaming}
            />
          ) : (
            <div className="mx-auto max-w-3xl space-y-5 px-6 py-8">
              {messages.map((msg) => (
                <Bubble key={msg.id} message={msg} />
              ))}
              {isHydrating ? (
                <p
                  data-testid="home-chat-hydrating"
                  className="text-center text-xs text-neutral-500"
                >
                  Loading thread…
                </p>
              ) : null}
              {error ? (
                <ErrorBanner error={error} configured={configured} />
              ) : null}
            </div>
          )}
        </section>

        <Composer
          draft={draft}
          onChange={setDraft}
          onSubmit={onFormSubmit}
          onKeyDown={onTextareaKey}
          busy={isStreaming}
          disabled={!configured}
          configured={configured}
        />
      </main>

      <ToolCallSidebar
        toolCalls={latestToolCalls}
        citations={aggregateCitations}
        isStreaming={isStreaming}
      />
    </div>
  );
}

function Bubble({ message }: { readonly message: AskBorjieMessage }) {
  const isUser = message.role === 'user';
  // Wave SUPERPOWERS — subscribe to chip emissions keyed by this
  // assistant turn's message id. User bubbles never carry chips, so
  // we pass null to short-circuit.
  const chipBuckets = useAdminChipEmissions(isUser ? null : message.id);
  return (
    <div
      data-testid={`home-chat-bubble-${message.role}`}
      data-streaming={message.streaming || undefined}
      className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
    >
      <div
        className={`max-w-2xl rounded-lg px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'border border-border bg-surface-sunken text-foreground'
            : `border ${
                message.errored
                  ? 'border-destructive/40 bg-destructive/10'
                  : 'border-signal-500/30 bg-surface'
              } text-foreground`
        }`}
      >
        {!isUser && message.toolCalls.length > 0 ? (
          <ul
            data-testid="home-chat-bubble-tools"
            className="m-0 mb-2 flex list-none flex-wrap gap-1 p-0"
            aria-label="Juniors invoked"
          >
            {message.toolCalls.map((call, i) => (
              <li
                key={`${call.name}_${i}`}
                className="rounded-full bg-signal-500/10 px-2 py-0.5 text-tiny font-medium tracking-wide text-signal-500"
              >
                {call.name}
                {call.status ? ` · ${call.status}` : ''}
                {typeof call.latencyMs === 'number'
                  ? ` (${call.latencyMs}ms)`
                  : ''}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="whitespace-pre-wrap">
          {message.text || (message.streaming ? '…' : '')}
          {message.streaming ? (
            <span
              aria-hidden="true"
              data-testid="home-chat-stream-cursor"
              className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-signal-500 align-text-bottom"
            />
          ) : null}
        </p>
        {!isUser && message.citations.length > 0 ? (
          <ul
            className="mt-2 flex flex-wrap gap-1.5"
            data-testid="home-chat-bubble-citations"
          >
            {message.citations.map((citation) => (
              <li
                key={citation.id}
                className="rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-tiny text-neutral-400"
              >
                {citation.id}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {!isUser ? (
        <AdminSuperpowerChips
          navigates={chipBuckets.navigates}
          prefills={chipBuckets.prefills}
          highlights={chipBuckets.highlights}
          shares={chipBuckets.shares}
          bulks={chipBuckets.bulks}
          bookmarks={chipBuckets.bookmarks}
        />
      ) : null}
    </div>
  );
}

function ErrorBanner({
  error,
  configured,
}: {
  readonly error: Error;
  readonly configured: boolean;
}) {
  const isAuth = error instanceof ApiError && error.status === 401;
  return (
    <div
      role="alert"
      data-testid="home-chat-error"
      className="rounded-md border border-warning/40 bg-warning-subtle/20 px-4 py-3 text-sm text-warning"
    >
      <div className="font-medium">
        {isAuth
          ? 'Session expired.'
          : !configured
            ? 'Brain backend not configured.'
            : 'The brain stream dropped.'}
      </div>
      <div className="mt-0.5 text-xs text-neutral-400">{error.message}</div>
    </div>
  );
}

interface ComposerProps {
  readonly draft: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  readonly onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly configured: boolean;
}

function Composer({
  draft,
  onChange,
  onSubmit,
  onKeyDown,
  busy,
  disabled,
  configured,
}: ComposerProps) {
  const rowCount = Math.min(6, Math.max(2, draft.split('\n').length));
  return (
    <form
      onSubmit={onSubmit}
      className="border-t border-border bg-surface-sunken px-6 py-4"
      data-testid="home-chat-composer"
      noValidate
    >
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={rowCount}
          placeholder={
            configured
              ? 'Ask Borjie internal — Swahili or English. Enter to send, Shift+Enter for newline.'
              : 'Set NEXT_PUBLIC_API_GATEWAY_URL to enable chat.'
          }
          aria-label="Ask Borjie internal"
          disabled={disabled}
          maxLength={2000}
          className="flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-neutral-500 focus:border-signal-500/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        />
        {busy ? (
          <button
            type="button"
            disabled
            aria-label="Generating"
            data-testid="home-chat-busy"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-neutral-400"
          >
            <Square className="h-4 w-4" aria-hidden="true" />
            Working
          </button>
        ) : (
          <button
            type="submit"
            aria-label="Send"
            disabled={disabled || draft.trim().length === 0}
            data-testid="home-chat-send"
            className="inline-flex items-center gap-1 rounded-md border border-signal-500/40 bg-signal-500/10 px-3 py-2 text-sm text-signal-500 hover:bg-signal-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            Ask
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * Exported wrapper that mounts the QueryProvider so this surface can be
 * dropped into any layout without depending on a parent provider. The
 * inner component owns the react-query hooks.
 */
export function HomeChat() {
  return (
    <QueryProvider>
      <HomeChatInner />
    </QueryProvider>
  );
}
