'use client';

import { Cpu, Sparkles } from 'lucide-react';
import type { BrainToolCall } from '@/lib/brain-api';

/**
 * Side panel rendering one card per orchestrator tool call. Surfaces
 * what the brain did to answer the owner — junior name, latency,
 * status, evidence-id count — so the right-hand rail acts as a
 * transparent execution log without forcing the owner into a separate
 * page.
 *
 * Mirrors the breadcrumb chips already shown inline in `AskBubble`,
 * but lifted to a stable rail card so the owner can pin attention to
 * the last brain run while continuing the conversation.
 */

export interface ToolCallSidebarProps {
  readonly toolCalls: ReadonlyArray<BrainToolCall>;
  readonly languagePreference: 'sw' | 'en';
}

interface SidebarCopy {
  readonly title: string;
  readonly empty: string;
  readonly evidence: (count: number) => string;
  readonly status: string;
  readonly latency: string;
}

function copyForLang(lang: 'sw' | 'en'): SidebarCopy {
  if (lang === 'sw') {
    return {
      title: 'Akili imefanya nini',
      empty:
        'Hakuna juniors waliotumika bado. Anza mazungumzo upande wa kushoto.',
      evidence: (count: number) => `${count} ushahidi`,
      status: 'Hali',
      latency: 'Muda',
    };
  }
  return {
    title: 'What the brain ran',
    empty:
      'No juniors invoked yet. Start a conversation on the left to see calls land here.',
    evidence: (count: number) =>
      `${count} evidence chunk${count === 1 ? '' : 's'}`,
    status: 'Status',
    latency: 'Latency',
  };
}

export function ToolCallSidebar({
  toolCalls,
  languagePreference,
}: ToolCallSidebarProps) {
  const copy = copyForLang(languagePreference);
  return (
    <aside
      data-testid="home-toolcall-sidebar"
      aria-label="Brain tool calls"
      className="flex w-80 shrink-0 flex-col gap-3 border-l border-border bg-surface/40 px-4 py-6"
    >
      <header className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-warning" aria-hidden="true" />
        <h3 className="font-display text-sm text-foreground">{copy.title}</h3>
      </header>
      {toolCalls.length === 0 ? (
        <p
          className="text-xs text-neutral-500"
          data-testid="home-toolcall-empty"
        >
          {copy.empty}
        </p>
      ) : (
        <ul className="m-0 flex flex-col gap-2 p-0 list-none">
          {toolCalls.map((call, i) => {
            const evidenceCount = call.evidenceIds?.length ?? 0;
            return (
              <li
                key={`${call.name}_${i}`}
                data-testid="home-toolcall-card"
                data-tool-name={call.name}
                className="rounded-md border border-border bg-background/60 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <Cpu
                    className="h-3.5 w-3.5 text-info"
                    aria-hidden="true"
                  />
                  <span className="font-mono text-sm text-foreground">
                    {call.name}
                  </span>
                </div>
                <dl className="mt-1 grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5 text-xs">
                  {call.status ? (
                    <>
                      <dt className="text-neutral-500">{copy.status}</dt>
                      <dd className="text-neutral-300">{call.status}</dd>
                    </>
                  ) : null}
                  {typeof call.latencyMs === 'number' ? (
                    <>
                      <dt className="text-neutral-500">{copy.latency}</dt>
                      <dd className="text-neutral-300">{call.latencyMs}ms</dd>
                    </>
                  ) : null}
                </dl>
                {evidenceCount > 0 ? (
                  <p
                    className="mt-1 text-tiny text-neutral-500"
                    data-testid="home-toolcall-evidence"
                  >
                    {copy.evidence(evidenceCount)}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
