'use client';

/**
 * UiBlockRenderer — renders one of the four teaching ui_block types
 * emitted by /api/v1/brain/teach.
 *
 * Palette + visual language follows the cockpit's existing tokens:
 *   - cards = bordered + rounded-md + bg-surface/40
 *   - accent gold (`text-warning`) for important labels
 *   - cream foreground for body text
 *   - red `text-destructive` reserved for warnings
 *
 * SURPASSES LitFin: the renderer supports four block types (vs LitFin's
 * two), each tuned to a strategic-intent frame:
 *   - concept_card  — TEACH frame, bordered card + bullets + bloom badge
 *   - metric_strip  — ASSESS frame, three KPI tiles
 *   - decision_card — EXECUTE frame, options with recommended highlighted
 *   - step_progress — SUMMARIZE frame, pill bar with 5 dots
 *
 * Inline metric chips render alongside paragraph text and are emitted as
 * a separate SSE event so the renderer can attach them as small chips.
 */

import type { ReactElement } from 'react';
import { ConceptCard as ConceptCardChrome, type ConceptCardBlock as ConceptCardChromeBlock } from './ConceptCard';
import { MicroLessonCard, type MicroLessonCardBlock } from './MicroLessonCard';

// ─── Block shapes ──────────────────────────────────────────────────

export interface ConceptCardBlock {
  readonly type: 'concept_card';
  readonly title?: string;
  readonly titleSw?: string;
  readonly description?: string;
  readonly descriptionSw?: string;
  readonly keyPoints?: ReadonlyArray<string>;
  readonly conceptId?: string;
  readonly bloomLevel?: string;
  readonly category?: string;
  readonly icon?: string;
  readonly masteryPercent?: number;
  readonly relatedConcepts?: ReadonlyArray<string>;
  readonly exploredKeyPoints?: ReadonlyArray<string | number>;
}

export interface MetricStripBlock {
  readonly type: 'metric_strip';
  readonly metrics?: ReadonlyArray<{
    readonly name?: string;
    readonly value?: string;
    readonly delta?: string;
  }>;
}

export interface DecisionCardBlock {
  readonly type: 'decision_card';
  readonly title?: string;
  readonly options?: ReadonlyArray<{
    readonly label?: string;
    readonly detail?: string;
  }>;
  readonly recommendedIndex?: number;
  readonly rationale?: string;
}

export interface StepProgressBlock {
  readonly type: 'step_progress';
  readonly current?: number;
  readonly total?: number;
  readonly label?: string;
  readonly next?: string;
}

export type TeachUiBlock =
  | ConceptCardBlock
  | MetricStripBlock
  | DecisionCardBlock
  | StepProgressBlock
  | MicroLessonCardBlock
  | { readonly type: string; readonly [key: string]: unknown };

export interface InlineMetric {
  readonly label: string;
  readonly value: string;
  readonly tone: 'positive' | 'neutral' | 'warning';
}

// ─── Block renderers ──────────────────────────────────────────────

function ConceptCard({
  block,
  language,
  onDeepDive,
  onGoWider,
  onRelatedClick,
}: {
  readonly block: ConceptCardBlock;
  readonly language: 'sw' | 'en';
  readonly onDeepDive?: (payload: { readonly title: string; readonly point: string | null }) => void;
  readonly onGoWider?: (payload: { readonly title: string; readonly point: string | null }) => void;
  readonly onRelatedClick?: (concept: string) => void;
}): ReactElement {
  // Hand off to the full-fidelity chrome renderer (matches the LitFin
  // stepper learning chat ConceptCard pixel-by-pixel — Borjie tokens).
  // `exactOptionalPropertyTypes` rejects literal `undefined`, so we
  // only include the keys that are actually present on the incoming
  // block. This keeps the chrome block schema clean while preserving
  // every field the brain may have emitted.
  const chromeBlock: ConceptCardChromeBlock = {
    type: 'concept_card',
    ...(block.title !== undefined && { title: block.title }),
    ...(block.titleSw !== undefined && { titleSw: block.titleSw }),
    ...(block.description !== undefined && { description: block.description }),
    ...(block.descriptionSw !== undefined && {
      descriptionSw: block.descriptionSw,
    }),
    ...(block.keyPoints !== undefined && { keyPoints: block.keyPoints }),
    ...(block.category !== undefined && { category: block.category }),
    ...(block.icon !== undefined && { icon: block.icon }),
    ...(block.bloomLevel !== undefined && { bloomLevel: block.bloomLevel }),
    ...(block.masteryPercent !== undefined && {
      masteryPercent: block.masteryPercent,
    }),
    ...(block.relatedConcepts !== undefined && {
      relatedConcepts: block.relatedConcepts,
    }),
    ...(block.exploredKeyPoints !== undefined && {
      exploredKeyPoints: block.exploredKeyPoints,
    }),
    ...(block.conceptId !== undefined && { conceptId: block.conceptId }),
  };
  return (
    <ConceptCardChrome
      block={chromeBlock}
      language={language}
      {...(onDeepDive ? { onDeepDive } : {})}
      {...(onGoWider ? { onGoWider } : {})}
      {...(onRelatedClick ? { onRelatedClick } : {})}
    />
  );
}

function MetricStrip({ block }: { readonly block: MetricStripBlock }): ReactElement {
  const items = Array.isArray(block.metrics) ? block.metrics.slice(0, 3) : [];
  return (
    <div
      data-testid="teach-block-metric-strip"
      className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3"
    >
      {items.map((m, i) => {
        const deltaText = typeof m.delta === 'string' ? m.delta.trim() : '';
        const deltaTone = deltaText.startsWith('-')
          ? 'text-destructive'
          : deltaText.startsWith('+')
            ? 'text-emerald-400'
            : 'text-neutral-500';
        return (
          <div
            key={i}
            className="rounded-md border border-border bg-surface/60 p-3"
          >
            <p className="text-tiny uppercase tracking-wide text-neutral-500">
              {m.name ?? '—'}
            </p>
            <p className="mt-1 font-mono text-base text-foreground tabular-nums">
              {m.value ?? '—'}
            </p>
            {deltaText ? (
              <p className={`mt-0.5 text-tiny ${deltaTone}`}>{deltaText}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function DecisionCard({ block }: { readonly block: DecisionCardBlock }): ReactElement {
  const options = Array.isArray(block.options) ? block.options : [];
  const recommended =
    typeof block.recommendedIndex === 'number' && block.recommendedIndex >= 0
      ? block.recommendedIndex
      : -1;
  return (
    <div
      data-testid="teach-block-decision-card"
      className="mt-3 rounded-md border border-info/40 bg-info/5 p-3"
    >
      <h3 className="text-sm font-semibold text-foreground">
        {block.title ?? 'Choose a path'}
      </h3>
      <ul className="mt-2 space-y-2">
        {options.map((opt, i) => {
          const isRec = i === recommended;
          return (
            <li
              key={i}
              className={`rounded border px-3 py-2 text-sm ${
                isRec
                  ? 'border-warning/60 bg-warning-subtle/20'
                  : 'border-border bg-surface/40'
              }`}
            >
              <p className="font-medium text-foreground">
                {opt.label ?? `Option ${i + 1}`}
                {isRec ? (
                  <span className="ml-2 rounded-full bg-warning/30 px-2 py-0.5 text-tiny font-semibold uppercase tracking-wide text-warning">
                    Recommended
                  </span>
                ) : null}
              </p>
              {opt.detail ? (
                <p className="mt-0.5 text-tiny text-neutral-400">{opt.detail}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {block.rationale ? (
        <p className="mt-2 text-tiny italic text-neutral-400">
          {block.rationale}
        </p>
      ) : null}
    </div>
  );
}

function StepProgress({ block }: { readonly block: StepProgressBlock }): ReactElement {
  const total = typeof block.total === 'number' && block.total > 0 ? block.total : 5;
  const current =
    typeof block.current === 'number' && block.current >= 1 && block.current <= total
      ? block.current
      : 1;
  return (
    <div
      data-testid="teach-block-step-progress"
      className="mt-3 rounded-md border border-border bg-surface/60 p-3"
    >
      <div className="flex items-center gap-1.5">
        {Array.from({ length: total }, (_, i) => i + 1).map((step) => {
          const done = step < current;
          const here = step === current;
          return (
            <span
              key={step}
              data-active={here || undefined}
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                done
                  ? 'bg-warning/60'
                  : here
                    ? 'bg-warning'
                    : 'bg-neutral-700'
              }`}
              aria-label={`Step ${step}${here ? ' (current)' : done ? ' (done)' : ''}`}
            />
          );
        })}
        <span className="ml-2 text-tiny text-neutral-500">
          {current}/{total}
        </span>
      </div>
      {block.label ? (
        <p className="mt-1.5 text-sm font-medium text-foreground">{block.label}</p>
      ) : null}
      {block.next ? (
        <p className="mt-0.5 text-tiny text-neutral-500">Next: {block.next}</p>
      ) : null}
    </div>
  );
}

// ─── Public renderer ──────────────────────────────────────────────

interface UiBlockRendererProps {
  readonly block: TeachUiBlock;
  readonly language?: 'sw' | 'en';
  readonly onDeepDive?: (payload: { readonly title: string; readonly point: string | null }) => void;
  readonly onGoWider?: (payload: { readonly title: string; readonly point: string | null }) => void;
  readonly onRelatedClick?: (concept: string) => void;
  readonly onMicroLessonCta?: (value: string) => void;
}

export function UiBlockRenderer({
  block,
  language = 'sw',
  onDeepDive,
  onGoWider,
  onRelatedClick,
  onMicroLessonCta,
}: UiBlockRendererProps): ReactElement | null {
  switch (block.type) {
    case 'concept_card':
      return (
        <ConceptCard
          block={block as ConceptCardBlock}
          language={language}
          {...(onDeepDive ? { onDeepDive } : {})}
          {...(onGoWider ? { onGoWider } : {})}
          {...(onRelatedClick ? { onRelatedClick } : {})}
        />
      );
    case 'metric_strip':
      return <MetricStrip block={block as MetricStripBlock} />;
    case 'decision_card':
      return <DecisionCard block={block as DecisionCardBlock} />;
    case 'step_progress':
      return <StepProgress block={block as StepProgressBlock} />;
    case 'micro_lesson':
      return (
        <MicroLessonCard
          block={block as MicroLessonCardBlock}
          language={language}
          {...(onMicroLessonCta ? { onCta: onMicroLessonCta } : {})}
        />
      );
    default:
      return null;
  }
}

interface InlineMetricChipProps {
  readonly metric: InlineMetric;
}

export function InlineMetricChip({ metric }: InlineMetricChipProps): ReactElement {
  const toneClass =
    metric.tone === 'positive'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
      : metric.tone === 'warning'
        ? 'border-destructive/40 bg-destructive/10 text-destructive'
        : 'border-border bg-surface/60 text-neutral-300';
  return (
    <span
      data-testid="teach-inline-metric"
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-tiny ${toneClass}`}
    >
      <span className="font-medium uppercase tracking-wide opacity-70">
        {metric.label}
      </span>
      <span className="font-mono tabular-nums">{metric.value}</span>
    </span>
  );
}
