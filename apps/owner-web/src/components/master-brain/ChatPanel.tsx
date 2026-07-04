'use client';

import { useState } from 'react';
import { useChatSession } from '@/lib/queries/chat';
import { useLocale, type Locale } from '@/lib/locale';
import { useScrollAnchor } from '@/components/home-chat/streaming/use-scroll-anchor';
import { IncrementalMarkdown } from '@/components/home-chat/streaming/incremental-markdown';
import { JumpToLatestPill } from '@/components/home-chat/streaming/JumpToLatestPill';
import { ChatShellDisclaimer } from '@borjie/chat-ui';
import { useT } from '@/i18n/t.client';
import { ChatBubble } from './ChatBubble';
import { Composer } from './Composer';
import { BreadcrumbStrip } from './BreadcrumbStrip';
import { EvidencePanel } from './EvidencePanel';

/**
 * Full Master Brain chat panel.
 *
 * Owns: transcript + streaming reply, in-flight breadcrumbs, evidence
 * side-panel state. There is no mode — Mr. Mwikila picks the persona
 * lens(es) per message on its own.
 */
interface ChatPanelProps {
  /**
   * Server-resolved locale, threaded from the master-brain page so useLocale
   * and useT SEED the first client render to the SAME language the SSR
   * `<html lang>` chrome used — without it both default to `en` and the
   * empty-state / streaming labels flash under an SW page (split-brain).
   */
  readonly initialLocale?: Locale | undefined;
}

export function ChatPanel({ initialLocale }: ChatPanelProps = {}) {
  // Thread the owner's ACTIVE locale (borjie_locale cookie, the single
  // source of truth) into the chat hook so the gateway is told the real
  // language. Seeded from the server-resolved `initialLocale`; `useLocale`
  // also re-renders when the owner flips the toggle mid-session.
  const locale = useLocale(initialLocale);
  const t = useT(initialLocale);
  const { state, send, abort } = useChatSession(locale);
  const [selectedEvidence, setSelectedEvidence] = useState<string | null>(null);
  // Stick-to-bottom ONLY when the owner is near the bottom (follow-on-growth via
  // ResizeObserver/MutationObserver, scroll-behavior:auto), with a "jump to
  // latest" pill when they scroll up — the same anti-yank contract the primary
  // cockpit chat uses. The old per-token `scrollTo({behavior:'smooth'})` effect
  // chased/shook the bottom on every streamed chunk; this kills that bug class.
  const { scrollRef, showJumpPill, jumpToLatest, resetAtStreamStart } =
    useScrollAnchor();

  return (
    <section className="flex h-chart-xl overflow-hidden rounded-lg border border-border bg-surface/40">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <BreadcrumbStrip
          breadcrumbs={state.streamingBreadcrumbs}
          streaming={state.streaming}
          locale={locale}
        />
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {state.messages.map((message) => (
            <ChatBubble
              key={message.id}
              message={message}
              onSelectEvidence={setSelectedEvidence}
              initialLocale={initialLocale}
            />
          ))}
          {state.streaming && state.streamingText ? (
            <div className="flex flex-col items-end gap-1">
              <div className="text-badge text-neutral-500">
                {t('masterBrain.streaming')}
              </div>
              <div className="max-w-2xl rounded-lg border border-warning/40 bg-warning-subtle/20 px-3 py-2 text-sm leading-relaxed text-foreground">
                <IncrementalMarkdown text={state.streamingText} />
                <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-warning" />
              </div>
            </div>
          ) : null}
          {state.messages.length === 0 && !state.streaming && !state.error ? (
            <div className="rounded-md border border-border bg-surface/40 px-3 py-2 text-sm text-neutral-400">
              {t('masterBrain.emptyState')}
            </div>
          ) : null}
          {state.error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {t('masterBrain.error', { error: state.error ?? '' })}
            </div>
          ) : null}
        </div>
        <JumpToLatestPill
          visible={showJumpPill}
          languagePreference={locale}
          onClick={jumpToLatest}
        />
        {/* CC-12 — the canonical AI-provenance disclaimer, rendered from the
            shared @borjie/chat-ui primitive in the owner's ACTIVE locale so it
            stays identical (and single-language) with every other chat
            surface. */}
        <ChatShellDisclaimer language={locale} />
        <Composer
          locale={locale}
          busy={state.streaming}
          onAbort={abort}
          onSubmit={(content) => {
            // Re-engage bottom-follow for the fresh answer so a prior scroll-up
            // doesn't strand the owner away from the new reply.
            resetAtStreamStart();
            void send({ content });
          }}
        />
      </div>
      <EvidencePanel
        evidenceId={selectedEvidence}
        evidence={
          selectedEvidence
            ? state.evidence.find((e) => e.id === selectedEvidence) ?? null
            : null
        }
        onClose={() => setSelectedEvidence(null)}
        initialLocale={initialLocale}
      />
    </section>
  );
}
