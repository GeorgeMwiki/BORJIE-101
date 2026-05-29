'use client';

/**
 * R-FUTURE-4 — generic drawer that hosts the per-entity timeline.
 *
 * Renders a right-side drawer (mobile-friendly slide-in) with the
 * entity header + the merged `<EntityTimeline />`. Each of the four
 * domain composers (reminders / drafts / parcels / bids) feeds this
 * with their pre-merged `TimelineEvent[]`.
 *
 * The drawer is presentational + headless on data — callers wire it
 * up with the composer of their choice. This keeps the polish wave
 * to a SINGLE drawer surface across the 4 entity types.
 */

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { EntityTimeline, type TimelineEvent } from '../shared/EntityTimeline';

export type DrawerEntityKind = 'reminder' | 'draft' | 'parcel' | 'bid';

interface EntityTimelineDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly events: ReadonlyArray<TimelineEvent>;
  readonly entityKind: DrawerEntityKind;
  readonly entityLabel: string;
  readonly locale: 'sw' | 'en';
  /** Hide rows with `via: 'legacy' | 'unknown'`. Default false. */
  readonly hideLegacy?: boolean;
}

const TITLE_BY_KIND: Record<DrawerEntityKind, { sw: string; en: string }> = {
  reminder: { sw: 'Historia ya kumbukumbu', en: 'Reminder history' },
  draft: { sw: 'Historia ya rasimu', en: 'Draft history' },
  parcel: { sw: 'Historia ya parcel', en: 'Parcel history' },
  bid: { sw: 'Historia ya zabuni', en: 'Bid history' },
};

export function EntityTimelineDrawer({
  open,
  onClose,
  events,
  entityKind,
  entityLabel,
  locale,
  hideLegacy = false,
}: EntityTimelineDrawerProps) {
  // Close on Escape — standard drawer affordance.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const title = TITLE_BY_KIND[entityKind][locale];
  const closeLabel = locale === 'sw' ? 'Funga' : 'Close';

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      data-testid="entity-timeline-drawer"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        onClick={onClose}
        className="flex-1 bg-background/60 backdrop-blur-sm"
        aria-label={closeLabel}
        data-testid="entity-timeline-drawer-backdrop"
      />
      <aside
        className="flex h-full w-full max-w-md flex-col border-l border-border bg-surface shadow-xl"
        data-testid="entity-timeline-drawer-panel"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            <p className="mt-0.5 text-xs text-neutral-500">{entityLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-neutral-400 hover:bg-card hover:text-foreground"
            aria-label={closeLabel}
            data-testid="entity-timeline-drawer-close"
          >
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <EntityTimeline
            events={events}
            title={locale === 'sw' ? 'Matukio' : 'Events'}
            hideLegacy={hideLegacy}
          />
        </div>
      </aside>
    </div>
  );
}
