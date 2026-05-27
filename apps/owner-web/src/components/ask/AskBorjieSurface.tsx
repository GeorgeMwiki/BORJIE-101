'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { isBrainConfigured } from '@/lib/brain-api';
import { useAskBorjie } from '@/lib/queries/brain';
import { ApiError } from '@/lib/api-client';
import { AskBubble } from './AskBubble';
import { AskComposer } from './AskComposer';
import { AskEmptyState, type AskEmptyKind } from './AskEmptyState';

/**
 * Ask-Borjie surface (O-W-23) — wires the LIVE `/api/v1/brain` endpoint
 * into the owner cockpit. Owns:
 *   - thread hydration via `?thread=...` URL parameter
 *   - the transcript + streaming reply
 *   - empty / error states (no mock fallback)
 *   - URL bookkeeping when the gateway returns a brand-new threadId
 *
 * Streaming approach:
 *   The brain `/turn` route returns JSON, not SSE — see the comment in
 *   `lib/brain-api.ts`. This surface still consumes the response via an
 *   async-iterable so a future SSE variant of the route can drop in
 *   without touching the component.
 */
export function AskBorjieSurface() {
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

  return (
    <div className="space-y-4 px-8 py-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl text-foreground">
            Ask Borjie Brain
          </h2>
          <p className="mt-0.5 text-xs text-neutral-400">
            Live wire to{' '}
            <code className="rounded bg-surface px-1 py-0.5 font-mono text-tiny">
              POST /api/v1/brain/turn
            </code>
            {threadId ? (
              <>
                {' '}
                · thread{' '}
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
            onClick={() => {
              reset();
              const url = new URL(window.location.href);
              url.searchParams.delete('thread');
              router.replace(`${url.pathname}${url.search}`, { scroll: false });
            }}
            className="rounded border border-border bg-surface px-3 py-1.5 text-xs text-neutral-400 hover:bg-surface/60"
            data-testid="ask-reset"
          >
            New thread
          </button>
        ) : null}
      </header>

      <section
        className="flex h-chart-xl flex-col overflow-hidden rounded-lg border border-border bg-surface/40"
        aria-label="Ask Borjie transcript"
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
              data-testid="ask-hydrating"
              className="text-center text-xs text-neutral-500"
            >
              Loading thread history…
            </p>
          ) : null}
          {error && messages.length > 0 ? (
            <div
              role="alert"
              data-testid="ask-error-inline"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error.message}
            </div>
          ) : null}
        </div>
        <AskComposer
          busy={isStreaming}
          disabled={!configured || emptyKind === 'unauthenticated'}
          onSubmit={(content) => void send(content)}
        />
      </section>
    </div>
  );
}

function resolveEmptyKind({
  configured,
  error,
  messageCount,
}: {
  readonly configured: boolean;
  readonly error: Error | null;
  readonly messageCount: number;
}): AskEmptyKind {
  if (!configured) return 'unconfigured';
  if (error instanceof ApiError && error.status === 401) {
    return 'unauthenticated';
  }
  if (error && messageCount === 0) return 'error';
  return 'fresh';
}
