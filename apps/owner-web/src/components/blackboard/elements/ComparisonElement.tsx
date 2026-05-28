'use client';

/**
 * ComparisonElement — two side-by-side cards under a single headline.
 *
 * Used by Mr. Mwikila for "file today vs hold for audit" beats, "hold
 * subsidiary vs sell", "Borjie marketplace vs phone-tag" comparisons.
 */

import type { ReactElement } from 'react';
import type { z } from 'zod';
import type { boardElementSchema, Bilingual } from '../types';

type ComparisonPayload = Extract<z.infer<typeof boardElementSchema>, { type: 'comparison' }>;
type Card = ComparisonPayload['cardA'];

function pick(b: Bilingual, lang: 'sw' | 'en'): string {
  return lang === 'sw' ? b.sw : b.en;
}

const TONE_CLASSES: Record<string, string> = {
  positive: 'border-success/40 bg-success/5 text-success',
  warning: 'border-warning/40 bg-warning/5 text-warning',
  critical: 'border-destructive/40 bg-destructive/5 text-destructive',
  neutral: 'border-border bg-surface/40 text-foreground',
};

export interface ComparisonElementProps {
  readonly payload: ComparisonPayload;
  readonly languagePreference: 'sw' | 'en';
}

export function ComparisonElement({
  payload,
  languagePreference,
}: ComparisonElementProps): ReactElement {
  return (
    <article
      data-testid="board-element-comparison"
      data-element-id={payload.id}
      className="rounded-xl border border-border bg-surface/60 px-4 py-3"
    >
      <p className="mb-3 text-tiny font-semibold uppercase tracking-wide text-warning">
        {pick(payload.headline, languagePreference)}
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <CardView card={payload.cardA} lang={languagePreference} />
        <CardView card={payload.cardB} lang={languagePreference} />
      </div>
    </article>
  );
}

function CardView({ card, lang }: { readonly card: Card; readonly lang: 'sw' | 'en' }): ReactElement {
  const metricTone = card.metric?.tone ?? 'neutral';
  return (
    <div
      className="rounded-lg border border-border bg-surface/40 px-3 py-3"
      data-testid="board-comparison-card"
    >
      <p className="text-sm font-semibold text-foreground">{pick(card.label, lang)}</p>
      <ul className="mt-2 list-none space-y-1 p-0 text-tiny text-neutral-300">
        {card.bullets.map((b, i) => (
          <li key={i} className="flex gap-1.5">
            <span aria-hidden="true" className="text-warning">·</span>
            <span>{pick(b, lang)}</span>
          </li>
        ))}
      </ul>
      {card.metric ? (
        <div
          className={`mt-3 inline-flex items-baseline gap-1.5 rounded-full border px-2 py-0.5 text-tiny ${TONE_CLASSES[metricTone] ?? TONE_CLASSES.neutral}`}
          data-testid="board-comparison-metric"
        >
          <span className="font-semibold">{card.metric.value}</span>
          <span className="opacity-80">{pick(card.metric.label, lang)}</span>
        </div>
      ) : null}
    </div>
  );
}
