'use client';

import Link from 'next/link';
import { ProvenancePill, type ProvenanceEnvelope } from './ProvenancePill';
import { bcp47For } from '@/lib/format';
import { pickByLocale, type Locale } from '@/lib/locale-shared';
import { dataAStrings as S } from '@/i18n/strings/data-a';

/**
 * Unified per-entity timeline.
 *
 * Implements principle 14 of the Chat-as-OS Bidirectional Parity
 * Manifesto: one timeline per entity that lists creation + revisions
 * + related chat turns, ordered chronologically, regardless of which
 * path (chat / form / agent / api) produced each event.
 *
 * Renders rows like:
 *
 *   - "Mr. Mwikila drafted via chat" 14:32     [via Mr. Mwikila]
 *   - "you edited via form" 16:01              [via you]
 *   - "Mr. Mwikila revised via chat" 18:45     [via Mr. Mwikila]
 *
 * The component is presentational — the caller is responsible for
 * fetching the timeline events. The shape is intentionally generic
 * (entity-kind independent) so the same component can power
 * ReminderDrawer, DraftDrawer, ParcelDrawer, BidDrawer, etc.
 */

export interface TimelineEvent {
  readonly id: string;
  readonly kind: 'created' | 'revised' | 'commented' | 'state_changed' | 'chat_turn';
  /** Human-readable summary (already localised). */
  readonly summary: string;
  readonly at: string;
  readonly actor: string;
  readonly provenance: ProvenanceEnvelope;
  /** Optional jump target (e.g. revision N detail). */
  readonly href?: string;
}

interface EntityTimelineProps {
  readonly events: ReadonlyArray<TimelineEvent>;
  /**
   * Active locale — drives the timestamp BCP-47 tag (the WIRE is
   * locale-neutral ISO; only the RENDER is localised) and the fallback
   * header / empty-state copy. Required so the timeline is never blind to
   * the user's language (it used to pin every timestamp to `sw-TZ`).
   */
  readonly locale: Locale;
  /** Localised header. Defaults to the locale-correct "Timeline". */
  readonly title?: string;
  /** Hide rows with `via: 'legacy' | 'unknown'`. Default false. */
  readonly hideLegacy?: boolean;
}

function fmtTime(iso: string, locale: Locale): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(bcp47For(locale), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const KIND_ICON: Record<TimelineEvent['kind'], string> = {
  created: '+',
  revised: '~',
  commented: 'C',
  state_changed: '!',
  chat_turn: 'M',
};

export function EntityTimeline({
  events,
  locale,
  title,
  hideLegacy = false,
}: EntityTimelineProps) {
  const resolvedTitle = title ?? pickByLocale(locale, S.entityTimeline.defaultTitle);
  const filtered = hideLegacy
    ? events.filter((e) => e.provenance.via !== 'legacy' && e.provenance.via !== 'unknown')
    : events;

  if (filtered.length === 0) {
    return (
      <div className="rounded-lg border border-border p-4 text-sm text-neutral-500">
        {pickByLocale(locale, S.entityTimeline.empty)}
      </div>
    );
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-foreground">{resolvedTitle}</h3>
      <ol className="space-y-1.5 border-l border-border pl-3">
        {filtered.map((e) => {
          const inner = (
            <div className="flex items-start gap-2">
              <span
                aria-hidden
                className="mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-border text-tiny text-neutral-400"
              >
                {KIND_ICON[e.kind]}
              </span>
              <div className="flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-foreground">{e.summary}</span>
                  <ProvenancePill provenance={e.provenance} />
                </div>
                <div className="mt-0.5 text-xs text-neutral-500">
                  {e.actor} · {fmtTime(e.at, locale)}
                </div>
              </div>
            </div>
          );
          return (
            <li key={e.id}>
              {e.href ? (
                <Link href={e.href} className="block rounded-md hover:bg-card/50">
                  {inner}
                </Link>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
