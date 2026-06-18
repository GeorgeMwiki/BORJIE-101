'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useChatScroll, JumpToLatestPill } from '@borjie/chat-ui';
import { useLocale } from '@/lib/locale';
import { pickByLocale } from '@/lib/locale-shared';
import { askEmptyStateStrings as S } from '@/i18n/strings/ask-empty-state';
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
  const locale = useLocale();
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
    abort,
    reset,
  } = useAskBorjie({
    initialThreadId,
    onThreadCreated: handleThreadCreated,
  });

  // Anchor-law scroll: the shared hook re-anchors on content growth ONLY while
  // the user is at the bottom (no mid-stream tail-yank), and surfaces a "jump
  // to latest" pill when they scroll up. Replaces the old
  // smooth-scrollTo-on-[messages.length] effect that never fired DURING a
  // stream, so a tall answer scrolled its own tail off-screen.
  const { scrollRef, showJumpPill, jumpToLatest, resetAtStreamStart } =
    useChatScroll();

  // Every send re-engages auto-follow at the top of the new turn so a prior
  // scroll-up never strands the owner away from the fresh answer.
  const submit = useCallback(
    (content: string): void => {
      resetAtStreamStart();
      void send(content);
    },
    [resetAtStreamStart, send],
  );

  // Seed the transcript from a `?prompt=` deep-link exactly once: the daily-
  // brief evidence CTA ("Open in Mr. Mwikila") and the /mwikila?prompt= cockpit
  // CTAs both land here. Guarded so it never re-fires on re-render or after the
  // owner has started their own conversation / is resuming a thread.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    const seed = searchParams?.get('prompt')?.trim();
    if (!seed || !configured || initialThreadId || messages.length > 0) return;
    seededRef.current = true;
    submit(seed);
  }, [searchParams, configured, initialThreadId, messages.length, submit]);

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
            {pickByLocale(locale, S.surfaceTitle)}
          </h2>
          <p className="mt-0.5 text-xs text-neutral-400">
            {pickByLocale(locale, S.surfaceLiveWire)}{' '}
            <code className="rounded bg-surface px-1 py-0.5 font-mono text-tiny">
              POST /api/v1/brain/turn
            </code>
            {threadId ? (
              <>
                {' '}
                · {pickByLocale(locale, S.surfaceThread)}{' '}
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
            {pickByLocale(locale, S.surfaceNewThread)}
          </button>
        ) : null}
      </header>

      <section
        className="flex h-chart-xl flex-col overflow-hidden rounded-lg border border-border bg-surface/40"
        aria-label="Ask Borjie transcript"
      >
        <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          className="h-full space-y-4 overflow-y-auto px-4 py-4"
          aria-live="polite"
        >
          {messages.length === 0 ? (
            <AskEmptyState
              kind={emptyKind}
              locale={locale}
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
              {pickByLocale(locale, S.surfaceLoadingHistory)}
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
          <JumpToLatestPill
            visible={showJumpPill}
            language={locale}
            onClick={jumpToLatest}
          />
        </div>
        <AskComposer
          busy={isStreaming}
          disabled={!configured || emptyKind === 'unauthenticated'}
          voiceLocale={locale}
          onSubmit={submit}
          onAbort={abort}
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
