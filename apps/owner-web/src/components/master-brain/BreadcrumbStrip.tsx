'use client';

import type { ChatBreadcrumb } from '@/lib/types/chat';

interface BreadcrumbStripProps {
  readonly breadcrumbs: ReadonlyArray<ChatBreadcrumb>;
  readonly streaming: boolean;
}

/**
 * Live agent-call breadcrumbs above the transcript. Lights up while a
 * stream is in flight; collapses to a thin label when idle.
 */
export function BreadcrumbStrip({ breadcrumbs, streaming }: BreadcrumbStripProps) {
  return (
    <div className="border-b border-border bg-surface/40 px-4 py-2 text-xs text-neutral-500">
      <span className="mr-2 uppercase tracking-wide">Junior calls</span>
      {breadcrumbs.length === 0 ? (
        <span className="text-neutral-500">
          {streaming ? 'Routing…' : 'Idle.'}
        </span>
      ) : (
        <span className="text-neutral-300">
          {breadcrumbs
            .map((bc) => `${bc.agent}·${bc.action} (${bc.latencyMs}ms)`)
            .join(' → ')}
        </span>
      )}
    </div>
  );
}
