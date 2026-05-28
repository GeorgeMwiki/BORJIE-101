'use client';

/**
 * InlineComparisonBlock — 2-3 side-by-side option cards.
 *
 * Schema source: `packages/owner-os-tabs/src/rich-inline-blocks.ts` →
 * `inlineComparisonSchema`. Each option carries bullets + metrics + a
 * required "Choose" micro-action. `highlightOptionId` flags the
 * recommended option visually.
 */

import type { ReactElement } from 'react';
import { Sparkles } from 'lucide-react';

type Tone = 'positive' | 'neutral' | 'warning';

interface Metric {
  readonly label?: { readonly en?: string; readonly sw?: string };
  readonly value?: string;
  readonly tone?: Tone;
}

interface ChooseAction {
  readonly label?: { readonly en?: string; readonly sw?: string };
  readonly kind?: 'micro_action_card';
  readonly payload?: Record<string, unknown>;
}

interface ComparisonOption {
  readonly id?: string;
  readonly headline?: { readonly en?: string; readonly sw?: string };
  readonly bullets?: ReadonlyArray<{ readonly en?: string; readonly sw?: string }>;
  readonly metrics?: ReadonlyArray<Metric>;
  readonly recommendedReason?: { readonly en?: string; readonly sw?: string };
  readonly chooseAction?: ChooseAction;
}

export interface InlineComparisonBlock {
  readonly type: 'inline_comparison';
  readonly title?: { readonly en?: string; readonly sw?: string };
  readonly options?: ReadonlyArray<ComparisonOption>;
  readonly highlightOptionId?: string;
  readonly [extra: string]: unknown;
}

export interface InlineComparisonBlockProps {
  readonly block: InlineComparisonBlock;
  readonly locale: 'sw' | 'en';
  readonly onAction?: (event: {
    readonly action: 'compare_choose';
    readonly payload: {
      readonly optionId: string;
      readonly forwarded: Record<string, unknown>;
    };
  }) => void;
}

const TONE_TEXT: Readonly<Record<Tone, string>> = {
  positive: 'text-emerald-300',
  neutral: 'text-foreground/80',
  warning: 'text-destructive',
};

function localised(
  value: { readonly en?: string; readonly sw?: string } | undefined,
  locale: 'sw' | 'en',
  fallback: string,
): string {
  if (!value) return fallback;
  return (locale === 'sw' ? value.sw : value.en) ?? value.en ?? value.sw ?? fallback;
}

export function InlineComparisonBlock({
  block,
  locale,
  onAction,
}: InlineComparisonBlockProps): ReactElement {
  const title = localised(
    block.title,
    locale,
    locale === 'sw' ? 'Linganisha' : 'Compare',
  );
  const highlight = block.highlightOptionId;
  const options = Array.isArray(block.options)
    ? block.options.filter((o): o is ComparisonOption => Boolean(o)).slice(0, 3)
    : [];

  return (
    <div
      data-testid="inline-block-inline-comparison"
      className="rounded-xl border border-border bg-surface/60 p-3"
    >
      <p className="text-tiny font-semibold uppercase tracking-wide text-foreground/70">
        {title}
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {options.map((opt, i) => {
          const id = typeof opt.id === 'string' ? opt.id : `opt_${i}`;
          const isRec = id === highlight;
          const headline = localised(opt.headline, locale, `Option ${i + 1}`);
          const bullets = Array.isArray(opt.bullets)
            ? opt.bullets.slice(0, 6)
            : [];
          const metrics = Array.isArray(opt.metrics)
            ? opt.metrics.slice(0, 4)
            : [];
          const recReason = localised(opt.recommendedReason, locale, '');
          const action = opt.chooseAction;
          const actionLabel = localised(
            action?.label,
            locale,
            locale === 'sw' ? 'Chagua' : 'Choose',
          );

          return (
            <div
              key={id}
              data-recommended={isRec || undefined}
              className={`relative rounded-lg border p-3 ${isRec ? 'border-warning/60 bg-warning/[0.05]' : 'border-border bg-surface/40'}`}
            >
              {isRec ? (
                <div className="absolute -top-2 left-3 inline-flex items-center gap-1 rounded-full bg-warning px-2 py-0.5 text-tiny font-semibold uppercase tracking-wide text-primary-foreground">
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  {locale === 'sw' ? 'Inashauriwa' : 'Recommended'}
                </div>
              ) : null}
              <h4 className="text-sm font-semibold text-foreground">
                {headline}
              </h4>
              {bullets.length > 0 ? (
                <ul className="mt-2 space-y-1 text-tiny text-foreground/80">
                  {bullets.map((b, bi) => (
                    <li key={bi}>· {localised(b, locale, '')}</li>
                  ))}
                </ul>
              ) : null}
              {metrics.length > 0 ? (
                <dl className="mt-3 grid grid-cols-2 gap-1.5 text-tiny">
                  {metrics.map((m, mi) => (
                    <div key={mi}>
                      <dt className="text-foreground/60">
                        {localised(m.label, locale, '')}
                      </dt>
                      <dd
                        className={`font-mono tabular-nums ${TONE_TEXT[m.tone ?? 'neutral']}`}
                      >
                        {m.value ?? '—'}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {recReason ? (
                <p className="mt-2 text-tiny italic text-foreground/70">
                  {recReason}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  onAction?.({
                    action: 'compare_choose',
                    payload: {
                      optionId: id,
                      forwarded:
                        action?.payload && typeof action.payload === 'object'
                          ? action.payload
                          : {},
                    },
                  })
                }
                className={`mt-3 w-full rounded-md px-2.5 py-1.5 text-tiny font-semibold transition-colors ${isRec ? 'bg-warning text-primary-foreground hover:bg-warning/90' : 'border border-border bg-surface text-foreground hover:bg-surface/80'}`}
              >
                {actionLabel}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
