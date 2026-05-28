'use client';

/**
 * ConfirmationCardBlock — high-stakes ask, auto-authorize aware.
 *
 * Schema source: `packages/owner-os-tabs/src/inline-blocks.ts` →
 * `confirmationCardSchema`. Renders the question + summary; when
 * `autoAuthorized=true` the rationale shows without buttons (the
 * backend has already executed the action). Otherwise both primary and
 * secondary buttons render and fire `onAction` with the chosen kind.
 */

import type { ReactElement } from 'react';
import { ShieldCheck } from 'lucide-react';

interface ActionDef {
  readonly label?: string;
  readonly kind?: 'destructive' | 'primary' | 'ghost';
}

export interface ConfirmationCardBlock {
  readonly type: 'confirmation_card';
  readonly question?: string;
  readonly summary?: string;
  readonly primaryAction?: ActionDef;
  readonly secondaryAction?: ActionDef;
  readonly autoAuthorized?: boolean;
  readonly rationale?: string;
  readonly actionId?: string;
  readonly payload?: Record<string, unknown>;
  readonly [extra: string]: unknown;
}

export interface ConfirmationCardBlockProps {
  readonly block: ConfirmationCardBlock;
  readonly locale: 'sw' | 'en';
  readonly onAction?: (event: {
    readonly action: 'primary' | 'secondary';
    readonly payload: {
      readonly actionId: string;
      readonly kind: ActionDef['kind'];
      readonly forwarded: Record<string, unknown>;
    };
  }) => void;
}

const KIND_CLASS: Readonly<Record<NonNullable<ActionDef['kind']>, string>> = {
  destructive:
    'bg-destructive text-primary-foreground hover:bg-destructive/90',
  primary:
    'bg-warning text-primary-foreground hover:bg-warning/90',
  ghost:
    'border border-border bg-surface text-foreground hover:bg-surface/80',
};

export function ConfirmationCardBlock({
  block,
  locale,
  onAction,
}: ConfirmationCardBlockProps): ReactElement {
  const question =
    typeof block.question === 'string'
      ? block.question
      : locale === 'sw'
        ? 'Tunahitaji idhini'
        : 'Confirmation requested';
  const summary = typeof block.summary === 'string' ? block.summary : '';
  const rationale = typeof block.rationale === 'string' ? block.rationale : '';
  const actionId = typeof block.actionId === 'string' ? block.actionId : '';
  const forwarded =
    block.payload && typeof block.payload === 'object' ? block.payload : {};
  const auto = block.autoAuthorized === true;

  if (auto) {
    return (
      <div
        data-testid="inline-block-confirmation-card-auto"
        className="rounded-xl border border-emerald-500/40 bg-emerald-500/[0.06] px-3 py-3"
      >
        <div className="flex items-center gap-2 text-emerald-300">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          <p className="text-tiny font-semibold uppercase tracking-wide">
            {locale === 'sw' ? 'Imeidhinishwa kiotomatiki' : 'Auto-authorised'}
          </p>
        </div>
        <p className="mt-2 text-sm font-medium text-foreground">{question}</p>
        {summary ? (
          <p className="mt-1 text-tiny text-foreground/70">{summary}</p>
        ) : null}
        {rationale ? (
          <p className="mt-2 text-tiny italic text-foreground/60">{rationale}</p>
        ) : null}
      </div>
    );
  }

  const primary = block.primaryAction ?? {};
  const secondary = block.secondaryAction ?? {};
  const primaryKind = primary.kind ?? 'primary';
  const secondaryKind = secondary.kind ?? 'ghost';

  return (
    <div
      data-testid="inline-block-confirmation-card"
      className="rounded-xl border border-warning/40 bg-warning/[0.04] px-3 py-3"
    >
      <p className="text-sm font-semibold text-foreground">{question}</p>
      {summary ? (
        <p className="mt-1 text-tiny text-foreground/70">{summary}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() =>
            onAction?.({
              action: 'primary',
              payload: { actionId, kind: primaryKind, forwarded },
            })
          }
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${KIND_CLASS[primaryKind]}`}
        >
          {primary.label ?? (locale === 'sw' ? 'Endelea' : 'Continue')}
        </button>
        <button
          type="button"
          onClick={() =>
            onAction?.({
              action: 'secondary',
              payload: { actionId, kind: secondaryKind, forwarded },
            })
          }
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${KIND_CLASS[secondaryKind]}`}
        >
          {secondary.label ?? (locale === 'sw' ? 'Ghairi' : 'Cancel')}
        </button>
      </div>
      {rationale ? (
        <p className="mt-2 text-tiny italic text-foreground/60">{rationale}</p>
      ) : null}
    </div>
  );
}
