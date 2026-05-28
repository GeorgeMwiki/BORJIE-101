'use client';

/**
 * MicroActionCardBlock — one-tap action chip.
 *
 * Schema source: `packages/owner-os-tabs/src/inline-blocks.ts` →
 * `microActionCardSchema`. Renders the bilingual label + a single
 * primary button. On click the owner-web layer routes the action
 * through `/api/v1/owner/chat/micro-action`; this component fires the
 * `onAction` callback the dispatcher hands down so the host owns the
 * dispatch contract.
 */

import type { ReactElement } from 'react';

export interface MicroActionCardBlock {
  readonly type: 'micro_action_card';
  readonly label?: { readonly en?: string; readonly sw?: string };
  readonly action?: string;
  readonly payload?: Record<string, unknown>;
  readonly [extra: string]: unknown;
}

export interface MicroActionCardBlockProps {
  readonly block: MicroActionCardBlock;
  readonly locale: 'sw' | 'en';
  readonly onAction?: (event: {
    readonly action: string;
    readonly payload: Record<string, unknown>;
  }) => void;
}

export function MicroActionCardBlock({
  block,
  locale,
  onAction,
}: MicroActionCardBlockProps): ReactElement {
  const label =
    (locale === 'sw' ? block.label?.sw : block.label?.en) ??
    block.label?.en ??
    block.label?.sw ??
    (locale === 'sw' ? 'Fanya hatua' : 'Take action');
  const action = typeof block.action === 'string' ? block.action : '';
  const payload =
    block.payload && typeof block.payload === 'object' ? block.payload : {};

  return (
    <div
      data-testid="inline-block-micro-action-card"
      className="rounded-xl border border-warning/30 bg-warning/[0.06] px-3 py-2.5"
    >
      <button
        type="button"
        disabled={action.length === 0}
        onClick={() => {
          if (action.length === 0) return;
          onAction?.({ action, payload });
        }}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-warning px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-warning/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {label}
      </button>
    </div>
  );
}
