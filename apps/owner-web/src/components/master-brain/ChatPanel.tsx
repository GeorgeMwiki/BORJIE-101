'use client';

import { useEffect, useRef, useState } from 'react';
import { useChatSession } from '@/lib/queries/chat';
import { CEO_MODES, type CeoModeId } from '@/lib/ceo-modes';
import { ChatBubble } from './ChatBubble';
import { Composer } from './Composer';
import { BreadcrumbStrip } from './BreadcrumbStrip';
import { EvidencePanel } from './EvidencePanel';

interface ChatPanelProps {
  readonly mode: CeoModeId;
}

/**
 * Full Master Brain chat panel.
 *
 * Owns: transcript + streaming reply, in-flight breadcrumbs, evidence
 * side-panel state. Mode is owned by the parent so the persona
 * switcher above can rebind it without unmounting this component.
 */
export function ChatPanel({ mode }: ChatPanelProps) {
  const { state, send, abort } = useChatSession();
  const [selectedEvidence, setSelectedEvidence] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [state.messages.length, state.streamingText]);

  const activeMode = CEO_MODES.find((m) => m.id === mode);
  const modeName = activeMode?.label ?? mode;

  return (
    <section className="flex h-[600px] overflow-hidden rounded-lg border border-border bg-surface/40">
      <div className="flex min-w-0 flex-1 flex-col">
        <BreadcrumbStrip
          breadcrumbs={state.streamingBreadcrumbs}
          streaming={state.streaming}
        />
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {state.messages.map((message) => (
            <ChatBubble
              key={message.id}
              message={message}
              onSelectEvidence={setSelectedEvidence}
            />
          ))}
          {state.streaming && state.streamingText ? (
            <div className="flex flex-col items-end gap-1">
              <div className="text-[11px] text-neutral-500">
                Master Brain · {modeName} · streaming…
              </div>
              <div className="max-w-2xl rounded-lg border border-warning/40 bg-warning-subtle/20 px-3 py-2 text-sm leading-relaxed text-foreground">
                <p className="whitespace-pre-wrap">{state.streamingText}</p>
                <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-warning" />
              </div>
            </div>
          ) : null}
          {state.messages.length === 0 && !state.streaming && !state.error ? (
            <div className="rounded-md border border-border bg-surface/40 px-3 py-2 text-sm text-neutral-400">
              Ask the Master Brain anything about your portfolio. Replies
              stream live from the gateway with cited evidence.
            </div>
          ) : null}
          {state.error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Chat stream failed: {state.error}. Check your connection and
              try again.
            </div>
          ) : null}
        </div>
        <Composer
          busy={state.streaming}
          onAbort={abort}
          onSubmit={(content) => void send({ content, mode })}
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
      />
    </section>
  );
}
