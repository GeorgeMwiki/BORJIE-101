'use client';

import { Activity, Database, Shield, Wrench } from 'lucide-react';
import type { BrainToolCall, BrainCitation } from '@/lib/brain-api';

/**
 * ToolCallSidebar — admin sees ALL data, not a single tenant slice. The
 * sidebar surfaces the juniors invoked by the most recent turn so the HQ
 * operator can audit which data layer the brain reached for. Evidence ids
 * are exposed verbatim — admin needs the linkable handle, not a polished
 * citation chip.
 *
 * Renders three slots:
 *   1. Latest tool calls (juniors), each with status + latency.
 *   2. Recent citations (corpus chunk ids) from the live transcript.
 *   3. A short routing legend that maps admin chip shorthand to the
 *      junior it normally triggers — so first-time HQ users learn the
 *      surface without reading docs.
 *
 * Pure presentational. State is owned by the parent HomeChat component.
 */

interface ToolCallSidebarProps {
  readonly toolCalls: ReadonlyArray<BrainToolCall>;
  readonly citations: ReadonlyArray<BrainCitation>;
  readonly isStreaming: boolean;
}

const ROUTING_LEGEND: ReadonlyArray<{
  readonly icon: typeof Database;
  readonly label: string;
  readonly junior: string;
}> = [
  { icon: Database, label: 'Tenants / signups', junior: 'TenantDirectory' },
  { icon: Shield, label: 'Kill-switch / policy', junior: 'PolicyGate' },
  { icon: Activity, label: 'Sentry / health', junior: 'Observability' },
  { icon: Wrench, label: 'Audit chain', junior: 'AuditLedger' },
];

export function ToolCallSidebar({
  toolCalls,
  citations,
  isStreaming,
}: ToolCallSidebarProps) {
  return (
    <aside
      data-testid="home-chat-sidebar"
      className="hidden w-thread-medium shrink-0 flex-col gap-6 overflow-y-auto border-l border-border bg-surface/30 px-5 py-6 lg:flex"
      aria-label="Admin tool calls and evidence"
    >
      <section>
        <h2 className="text-caption uppercase tracking-widest text-neutral-500">
          Latest juniors
        </h2>
        <p className="mt-1 text-tiny text-neutral-500">
          Which orchestrator tools answered the last turn.
        </p>
        <ul
          className="mt-3 space-y-2"
          data-testid="home-chat-tool-list"
        >
          {toolCalls.length === 0 ? (
            <li className="rounded border border-dashed border-border bg-surface/40 px-3 py-2 text-xs text-neutral-500">
              {isStreaming
                ? 'Brain is dispatching…'
                : 'No tool calls yet. Send a prompt to spin up juniors.'}
            </li>
          ) : (
            toolCalls.map((call, i) => (
              <li
                key={`${call.name}_${i}`}
                className="rounded-md border border-border bg-surface px-3 py-2"
                data-testid="home-chat-tool-item"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-foreground">
                    {call.name}
                  </span>
                  {call.status ? (
                    <span
                      className={`text-tiny uppercase tracking-widest ${
                        call.status.toLowerCase().startsWith('err') ||
                        call.status.toLowerCase().includes('fail')
                          ? 'text-destructive'
                          : 'text-signal-500'
                      }`}
                    >
                      {call.status}
                    </span>
                  ) : null}
                </div>
                {typeof call.latencyMs === 'number' ? (
                  <div className="mt-1 text-tiny text-neutral-500">
                    {call.latencyMs} ms
                  </div>
                ) : null}
                {call.evidenceIds && call.evidenceIds.length > 0 ? (
                  <div className="mt-1 text-tiny text-neutral-500">
                    {call.evidenceIds.length} evidence id
                    {call.evidenceIds.length === 1 ? '' : 's'}
                  </div>
                ) : null}
              </li>
            ))
          )}
        </ul>
      </section>

      <section>
        <h2 className="text-caption uppercase tracking-widest text-neutral-500">
          Evidence / citations
        </h2>
        <p className="mt-1 text-tiny text-neutral-500">
          Chunk ids returned by the corpus. Admin sees raw handles.
        </p>
        <ul
          className="mt-3 space-y-1"
          data-testid="home-chat-citation-list"
        >
          {citations.length === 0 ? (
            <li className="rounded border border-dashed border-border bg-surface/40 px-3 py-2 text-xs text-neutral-500">
              None on this turn.
            </li>
          ) : (
            citations.slice(0, 8).map((citation) => (
              <li
                key={citation.id}
                className="rounded-md border border-border bg-surface px-3 py-1.5"
              >
                <code className="font-mono text-tiny text-foreground">
                  {citation.id}
                </code>
                {citation.section ? (
                  <div className="mt-0.5 truncate text-tiny text-neutral-500">
                    {citation.section}
                  </div>
                ) : null}
              </li>
            ))
          )}
        </ul>
      </section>

      <section>
        <h2 className="text-caption uppercase tracking-widest text-neutral-500">
          Routing legend
        </h2>
        <ul className="mt-3 space-y-2">
          {ROUTING_LEGEND.map((item) => {
            const Icon = item.icon;
            return (
              <li
                key={item.junior}
                className="flex items-center gap-2 text-xs text-neutral-300"
              >
                <Icon
                  className="h-3.5 w-3.5 text-signal-500"
                  aria-hidden="true"
                />
                <span className="flex-1">{item.label}</span>
                <code className="font-mono text-tiny text-neutral-500">
                  {item.junior}
                </code>
              </li>
            );
          })}
        </ul>
      </section>
    </aside>
  );
}
