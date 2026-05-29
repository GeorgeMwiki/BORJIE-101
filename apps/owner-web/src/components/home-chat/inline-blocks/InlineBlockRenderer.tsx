'use client';

/**
 * InlineBlockRenderer — single-source dispatcher for every inline-first
 * block kind the brain may emit.
 *
 * Wave OWNER-OS-INLINE-FIRST + RICH + UNIVERSAL-DOC-DRAFTER. The brain
 * emits one of sixteen inline block kinds inside a `<ui_block>{...}</ui_block>`
 * tag; this component routes by `type` to the bespoke renderer in this
 * folder.
 *
 * Layer 1 (small slices):
 *   - mini_metric, data_capture_card, confirmation_card,
 *     file_request_card, micro_action_card, tab_promotion_chip
 *
 * Layer 2 (rich):
 *   - inline_table, inline_chart, inline_wizard, inline_workflow,
 *     inline_comparison, inline_section (recursive), inline_dashboard
 *     (recursive)
 *
 * Draft Authoring (Universal Drafter):
 *   - draft_edit (editable revision), draft_preview (read-only preview
 *     with format chips + action buttons)
 *
 * Teaching companions kept here for chat-side completeness:
 *   - doc_quest, level_select
 *
 * Unknown kinds render a dev-only placeholder so the brain can emit new
 * kinds without crashing the bubble.
 */

import type { ReactElement } from 'react';
import {
  MiniMetricBlock,
  type MiniMetricBlock as MiniMetricBlockShape,
} from './MiniMetricBlock';
import {
  MicroActionCardBlock,
  type MicroActionCardBlock as MicroActionCardBlockShape,
} from './MicroActionCardBlock';
import {
  TabPromotionChipBlock,
  type TabPromotionChipBlock as TabPromotionChipBlockShape,
} from './TabPromotionChipBlock';
import {
  DataCaptureCardBlock,
  type DataCaptureCardBlock as DataCaptureCardBlockShape,
} from './DataCaptureCardBlock';
import {
  ConfirmationCardBlock,
  type ConfirmationCardBlock as ConfirmationCardBlockShape,
} from './ConfirmationCardBlock';
import {
  FileRequestCardBlock,
  type FileRequestCardBlock as FileRequestCardBlockShape,
} from './FileRequestCardBlock';
import {
  InlineTableBlock,
  type InlineTableBlock as InlineTableBlockShape,
} from './InlineTableBlock';
import {
  InlineChartBlock,
  type InlineChartBlock as InlineChartBlockShape,
} from './InlineChartBlock';
import {
  InlineWizardBlock,
  type InlineWizardBlock as InlineWizardBlockShape,
} from './InlineWizardBlock';
import {
  InlineWorkflowBlock,
  type InlineWorkflowBlock as InlineWorkflowBlockShape,
} from './InlineWorkflowBlock';
import {
  InlineComparisonBlock,
  type InlineComparisonBlock as InlineComparisonBlockShape,
} from './InlineComparisonBlock';
import {
  InlineSectionBlock,
  type InlineSectionBlock as InlineSectionBlockShape,
} from './InlineSectionBlock';
import {
  InlineDashboardBlock,
  type InlineDashboardBlock as InlineDashboardBlockShape,
} from './InlineDashboardBlock';
import {
  DocQuestBlock,
  type DocQuestBlock as DocQuestBlockShape,
} from './DocQuestBlock';
import {
  LevelSelectBlock,
  type LevelSelectBlock as LevelSelectBlockShape,
} from './LevelSelectBlock';
import {
  DraftEditBlock,
  type DraftEditBlockProps,
} from './DraftEditBlock';
import {
  DraftPreviewBlock,
  type DraftPreviewBlockProps,
} from './DraftPreviewBlock';
import {
  CitationsBlock,
  type CitationsBlock as CitationsBlockShape,
} from './CitationsBlock';

export type AnyInlineBlock = Record<string, unknown> & { readonly type?: string };

export interface InlineBlockActionEvent {
  readonly action: string;
  readonly payload: unknown;
}

export interface InlineBlockRendererProps {
  readonly block: AnyInlineBlock;
  readonly locale: 'sw' | 'en';
  readonly sessionId?: string;
  readonly depth?: number;
  readonly onAction?: (event: InlineBlockActionEvent) => void;
}

/**
 * Render one inline block. Returns `null` only when the block is
 * malformed (no `type` field). Unknown kinds render an in-bubble dev
 * placeholder so missing renderers stay visible during integration.
 */
export function InlineBlockRenderer({
  block,
  locale,
  sessionId,
  depth = 0,
  onAction,
}: InlineBlockRendererProps): ReactElement | null {
  if (!block || typeof block !== 'object') return null;
  const kind = block.type;
  if (typeof kind !== 'string' || kind.length === 0) return null;

  switch (kind) {
    case 'mini_metric':
      return (
        <MiniMetricBlock
          block={block as MiniMetricBlockShape}
          locale={locale}
        />
      );
    case 'micro_action_card':
      return (
        <MicroActionCardBlock
          block={block as MicroActionCardBlockShape}
          locale={locale}
          {...(onAction ? { onAction } : {})}
        />
      );
    case 'tab_promotion_chip':
      return (
        <TabPromotionChipBlock
          block={block as TabPromotionChipBlockShape}
          locale={locale}
          {...(onAction ? { onAction } : {})}
        />
      );
    case 'data_capture_card':
      return (
        <DataCaptureCardBlock
          block={block as DataCaptureCardBlockShape}
          locale={locale}
          {...(onAction ? { onAction } : {})}
        />
      );
    case 'confirmation_card':
      return (
        <ConfirmationCardBlock
          block={block as ConfirmationCardBlockShape}
          locale={locale}
          {...(onAction ? { onAction } : {})}
        />
      );
    case 'file_request_card':
      return (
        <FileRequestCardBlock
          block={block as FileRequestCardBlockShape}
          locale={locale}
          {...(onAction ? { onAction } : {})}
        />
      );
    case 'draft_edit':
      return (
        <DraftEditBlock
          block={block as DraftEditBlockProps['block']}
          locale={locale}
          {...(onAction ? { onAction } : {})}
        />
      );
    case 'draft_preview':
      return (
        <DraftPreviewBlock
          block={block as DraftPreviewBlockProps['block']}
          locale={locale}
          {...(onAction ? { onAction } : {})}
        />
      );
    case 'citations_block':
      return (
        <CitationsBlock
          block={block as CitationsBlockShape}
          locale={locale}
        />
      );
    case 'inline_table':
      return (
        <InlineTableBlock
          block={block as InlineTableBlockShape}
          locale={locale}
          {...(onAction ? { onAction } : {})}
        />
      );
    case 'inline_chart':
      return (
        <InlineChartBlock
          block={block as InlineChartBlockShape}
          locale={locale}
        />
      );
    case 'inline_wizard':
      return (
        <InlineWizardBlock
          block={block as InlineWizardBlockShape}
          locale={locale}
          {...(sessionId !== undefined ? { sessionId } : {})}
          {...(onAction ? { onAction } : {})}
        />
      );
    case 'inline_workflow':
      return (
        <InlineWorkflowBlock
          block={block as InlineWorkflowBlockShape}
          locale={locale}
          {...(onAction ? { onAction } : {})}
        />
      );
    case 'inline_comparison':
      return (
        <InlineComparisonBlock
          block={block as InlineComparisonBlockShape}
          locale={locale}
          {...(onAction ? { onAction } : {})}
        />
      );
    case 'inline_section':
      return (
        <InlineSectionBlock
          block={block as InlineSectionBlockShape}
          locale={locale}
          depth={depth}
          renderChild={(child, nextDepth) => (
            <InlineBlockRenderer
              block={child}
              locale={locale}
              depth={nextDepth}
              {...(sessionId !== undefined ? { sessionId } : {})}
              {...(onAction ? { onAction } : {})}
            />
          )}
        />
      );
    case 'inline_dashboard':
      return (
        <InlineDashboardBlock
          block={block as InlineDashboardBlockShape}
          locale={locale}
          depth={depth}
          renderChild={(child, nextDepth) => (
            <InlineBlockRenderer
              block={child}
              locale={locale}
              depth={nextDepth}
              {...(sessionId !== undefined ? { sessionId } : {})}
              {...(onAction ? { onAction } : {})}
            />
          )}
        />
      );
    case 'doc_quest':
      return (
        <DocQuestBlock
          block={block as DocQuestBlockShape}
          locale={locale}
          {...(onAction ? { onAction } : {})}
        />
      );
    case 'level_select':
      return (
        <LevelSelectBlock
          block={block as LevelSelectBlockShape}
          locale={locale}
          {...(onAction ? { onAction } : {})}
        />
      );
    default:
      return (
        <div
          data-testid={`inline-block-unknown-${kind}`}
          className="rounded-xl border border-dashed border-foreground/30 bg-surface/20 px-3 py-2 text-tiny text-foreground/60"
        >
          [unknown block: {kind}]
        </div>
      );
  }
}
