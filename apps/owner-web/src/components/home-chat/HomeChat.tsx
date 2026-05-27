'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { isBrainConfigured } from '@/lib/brain-api';
import type { BrainToolCall } from '@/lib/brain-api';
import { useAskBorjie } from '@/lib/queries/brain';
import { ApiError } from '@/lib/api-client';
import { AskBubble } from '@/components/ask/AskBubble';
import { AskComposer } from '@/components/ask/AskComposer';
import {
  AskEmptyState,
  type AskEmptyKind,
} from '@/components/ask/AskEmptyState';
import { PersonaGreeting } from './PersonaGreeting';
import { ToolCallSidebar } from './ToolCallSidebar';

/**
 * HomeChat — chat-first surface that becomes the owner's `/` (home).
 *
 * Composition:
 *   - Persona greeting card on top (only when no messages yet).
 *   - Suggestion chips that route through the same `send` pipeline as
 *     the composer, so the brain receives an indistinguishable turn.
 *   - The existing AskBubble + AskComposer + AskEmptyState transcript
 *     for behavioural parity with `/ask` (Agent 2's surface stays
 *     untouched).
 *   - A tool-call sidebar on lg+ breakpoints rendering one card per
 *     orchestrator junior call from the most recent brain response.
 *
 * Why we own `useAskBorjie` here instead of nesting AskBorjieSurface:
 *   - The hook holds its own React state, so a nested AskBorjieSurface
 *     would NOT share thread/messages with the host. We need the
 *     transcript here to power the sidebar.
 *   - This component still shares every leaf primitive with the /ask
 *     route (AskBubble, AskComposer, AskEmptyState, CitationChip), so
 *     there is one rendering implementation for the chat itself.
 *   - The only behavioural difference vs /ask is the greeting block
 *     and the sidebar — both layered on top, not replacing anything.
 */

export interface HomeChatProps {
  readonly salutation: string;
  readonly tradingName: string;
  readonly languagePreference: 'sw' | 'en';
}

function resolveEmptyKind(args: {
  readonly configured: boolean;
  readonly error: Error | null;
  readonly messageCount: number;
}): AskEmptyKind {
  if (!args.configured) return 'unconfigured';
  if (args.error instanceof ApiError && args.error.status === 401) {
    return 'unauthenticated';
  }
  if (args.error && args.messageCount === 0) return 'error';
  return 'fresh';
}

function latestToolCalls(
  messages: ReadonlyArray<{
    readonly role: 'user' | 'assistant';
    readonly toolCalls: ReadonlyArray<BrainToolCall>;
  }>,
): ReadonlyArray<BrainToolCall> {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m && m.role === 'assistant' && m.toolCalls.length > 0) {
      return m.toolCalls;
    }
  }
  return [];
}

export function HomeChat({
  salutation,
  tradingName,
  languagePreference,
}: HomeChatProps) {
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
    isStreaming,
    isHydrating,
    error,
    send,
    reset,
  } = useAskBorjie({
    initialThreadId,
    onThreadCreated: handleThreadCreated,
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof el.scrollTo !== 'function') return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages.length, isStreaming]);

  const emptyKind = resolveEmptyKind({
    configured,
    error,
    messageCount: messages.length,
  });

  const toolCalls = useMemo(() => latestToolCalls(messages), [messages]);

  const onSuggestion = useCallback(
    (text: string) => {
      void send(text);
    },
    [send],
  );

  const onReset = useCallback(() => {
    reset();
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.delete('thread');
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }, [reset, router]);

  const composerDisabled =
    !configured || emptyKind === 'unauthenticated';
  const showGreeting = messages.length === 0;

  return (
    <div
      className="flex flex-1 overflow-hidden"
      data-testid="home-chat-root"
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
                ? 'Mazungumzo na akili ya Borjie'
                : 'Conversation with Borjie Brain'}
              {threadId ? (
                <>
                  {' '}
                  ·{' '}
                  <code className="rounded bg-surface px-1 py-0.5 font-mono text-tiny">
                    {threadId.slice(0, 8)}
                  </code>
                </>
              ) : null}
            </p>
          </div>
          {messages.length > 0 ? (
            <button
              type="button"
              onClick={onReset}
              className="rounded border border-border bg-surface px-3 py-1.5 text-xs text-neutral-400 hover:bg-surface/60"
              data-testid="home-chat-reset"
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
          aria-label="Borjie Brain transcript"
          data-testid="home-chat-transcript"
        >
          <div
            ref={scrollRef}
            className="flex-1 space-y-4 overflow-y-auto px-4 py-4"
            aria-live="polite"
          >
            {messages.length === 0 ? (
              <AskEmptyState
                kind={emptyKind}
                detail={
                  emptyKind === 'error' && error ? error.message : null
                }
              />
            ) : (
              messages.map((message) => (
                <AskBubble key={message.id} message={message} />
              ))
            )}
            {isHydrating ? (
              <p
                data-testid="home-chat-hydrating"
                className="text-center text-xs text-neutral-500"
              >
                {languagePreference === 'sw'
                  ? 'Inapakia mazungumzo…'
                  : 'Loading thread history…'}
              </p>
            ) : null}
            {error && messages.length > 0 ? (
              <div
                role="alert"
                data-testid="home-chat-error-inline"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error.message}
              </div>
            ) : null}
          </div>
          <AskComposer
            busy={isStreaming}
            disabled={composerDisabled}
            onSubmit={(content) => void send(content)}
          />
        </section>
      </div>
      <div className="hidden lg:flex">
        <ToolCallSidebar
          toolCalls={toolCalls}
          languagePreference={languagePreference}
        />
      </div>
    </div>
  );
}
