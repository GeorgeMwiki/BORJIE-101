'use client';

import { X } from 'lucide-react';
import { MOCK_EVIDENCE_LIBRARY } from '@/lib/mocks/chat';

interface EvidencePanelProps {
  readonly evidenceId: string | null;
  readonly onClose: () => void;
}

/**
 * Right-hand side panel that shows the cited chunk for a selected
 * evidence pill. Closes when the owner taps the X or clicks another
 * chip.
 */
export function EvidencePanel({ evidenceId, onClose }: EvidencePanelProps) {
  if (!evidenceId) return null;
  const ev = MOCK_EVIDENCE_LIBRARY.find((e) => e.id === evidenceId);
  if (!ev) return null;
  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-surface/60">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-neutral-500">
            Evidence
          </div>
          <div className="mt-0.5 text-sm font-medium text-foreground">
            {ev.label}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close evidence panel"
          className="rounded-md p-1 text-neutral-400 hover:bg-surface hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-4 text-sm leading-relaxed text-foreground">
        <div className="mb-3 text-xs text-neutral-400">
          {ev.docTitle}
          {ev.page ? ` · page ${ev.page}` : ''}
        </div>
        <blockquote className="border-l-2 border-warning pl-3 text-neutral-200">
          {ev.excerpt}
        </blockquote>
      </div>
    </aside>
  );
}
