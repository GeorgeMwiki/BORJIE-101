'use client';

/**
 * TabPromotionChipBlock — escape-hatch chip that spawns the full tab.
 *
 * Schema source: `packages/owner-os-tabs/src/inline-blocks.ts` →
 * `tabPromotionChipSchema`. The label is intentionally specific
 * ("See full Geita compliance") rather than generic ("Open tab").
 *
 * The dispatcher binds `onAction` to the host's `spawnOrAugment` call
 * so click semantics live with the parent owner-os shell.
 */

import type { ReactElement } from 'react';
import { ArrowUpRight } from 'lucide-react';

export interface TabPromotionChipBlock {
  readonly type: 'tab_promotion_chip';
  readonly tabType?: string;
  readonly context?: Record<string, unknown>;
  readonly label?: { readonly en?: string; readonly sw?: string };
  readonly [extra: string]: unknown;
}

export interface TabPromotionChipBlockProps {
  readonly block: TabPromotionChipBlock;
  readonly locale: 'sw' | 'en';
  readonly onAction?: (event: {
    readonly action: 'spawn_tab';
    readonly payload: {
      readonly tabType: string;
      readonly context: Record<string, unknown>;
    };
  }) => void;
}

export function TabPromotionChipBlock({
  block,
  locale,
  onAction,
}: TabPromotionChipBlockProps): ReactElement {
  const tabType = typeof block.tabType === 'string' ? block.tabType : '';
  const context =
    block.context && typeof block.context === 'object' ? block.context : {};
  const label =
    (locale === 'sw' ? block.label?.sw : block.label?.en) ??
    block.label?.en ??
    block.label?.sw ??
    (locale === 'sw' ? 'Fungua tab kamili' : 'Open full tab');

  return (
    <button
      type="button"
      data-testid="inline-block-tab-promotion-chip"
      disabled={tabType.length === 0}
      onClick={() => {
        if (tabType.length === 0) return;
        onAction?.({
          action: 'spawn_tab',
          payload: { tabType, context },
        });
      }}
      className="inline-flex items-center gap-1.5 rounded-full border border-info/40 bg-info/[0.08] px-3 py-1 text-tiny font-semibold text-info transition-colors hover:bg-info/[0.15] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span>{label}</span>
      <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
    </button>
  );
}
