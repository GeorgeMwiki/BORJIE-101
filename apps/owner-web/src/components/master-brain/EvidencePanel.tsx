'use client';

import { X } from 'lucide-react';
import { useT } from '@/i18n/t.client';
import type { Locale } from '@/lib/locale';
import type { ChatEvidence } from '@/lib/types/chat';

interface EvidencePanelProps {
  readonly evidenceId: string | null;
  readonly evidence: ChatEvidence | null;
  readonly onClose: () => void;
  /**
   * Server-resolved locale, threaded from ChatPanel so `useT` SEEDS the
   * first client render to the active language — without it the panel chrome
   * ("Evidence", "page N") flashes EN under an SW page (split-brain).
   */
  readonly initialLocale?: Locale | undefined;
}

/**
 * Right-hand side panel that shows the cited chunk for a selected
 * evidence pill. Closes when the owner taps the X or clicks another
 * chip. The parent passes the resolved `evidence` payload (sourced
 * from the live chat stream).
 */
export function EvidencePanel({
  evidenceId,
  evidence,
  onClose,
  initialLocale,
}: EvidencePanelProps) {
  const t = useT(initialLocale);
  if (!evidenceId) return null;
  if (!evidence) {
    return (
      <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-surface/60">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-neutral-500">
              {t('evidence.title')}
            </div>
            <div className="mt-0.5 text-sm font-medium text-foreground">
              {evidenceId}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('evidence.closeAria')}
            className="rounded-md p-1 text-neutral-400 hover:bg-surface hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4 text-sm leading-relaxed text-neutral-400">
          {t('evidence.unavailable')}
        </div>
      </aside>
    );
  }
  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-surface/60">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-neutral-500">
            {t('evidence.title')}
          </div>
          <div className="mt-0.5 text-sm font-medium text-foreground">
            {evidence.label}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('evidence.closeAria')}
          className="rounded-md p-1 text-neutral-400 hover:bg-surface hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-4 text-sm leading-relaxed text-foreground">
        <div className="mb-3 text-xs text-neutral-400">
          {evidence.docTitle}
          {evidence.page ? ` · ${t('evidence.page', { page: evidence.page })}` : ''}
        </div>
        <blockquote className="border-l-2 border-warning pl-3 text-neutral-200">
          {evidence.excerpt}
        </blockquote>
      </div>
    </aside>
  );
}
