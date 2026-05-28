'use client';

/**
 * DocQuestBlock — document side-quest.
 *
 * Schema source: the brain emits `<ui_block>{"type":"doc_quest", title,
 * steps[{label, source}], deadline?, priority?}</ui_block>`. Used when
 * the brain spots a missing regulatory document and proactively assigns
 * a tracked side-quest (NEMC EIA refresh, BRELA renewal, etc.).
 *
 * Each step click can fire `onAction` if the host wants to track
 * progress against the quest in the cockpit.
 */

import type { ReactElement } from 'react';
import { Scroll, Calendar, Flag } from 'lucide-react';

type Priority = 'low' | 'medium' | 'high';

interface QuestStep {
  readonly label?: string;
  readonly source?: string;
}

export interface DocQuestBlock {
  readonly type: 'doc_quest';
  readonly title?: string;
  readonly steps?: ReadonlyArray<QuestStep>;
  readonly deadline?: string;
  readonly priority?: Priority;
  readonly [extra: string]: unknown;
}

export interface DocQuestBlockProps {
  readonly block: DocQuestBlock;
  readonly locale: 'sw' | 'en';
  readonly onAction?: (event: {
    readonly action: 'start_quest' | 'open_step';
    readonly payload: { readonly title: string; readonly stepIndex?: number };
  }) => void;
}

const PRIORITY_TONE: Readonly<Record<Priority, string>> = {
  high: 'border-destructive/50 bg-destructive/[0.06] text-destructive',
  medium: 'border-warning/50 bg-warning/[0.06] text-warning',
  low: 'border-info/40 bg-info/[0.06] text-info',
};

export function DocQuestBlock({
  block,
  locale,
  onAction,
}: DocQuestBlockProps): ReactElement {
  const title =
    typeof block.title === 'string'
      ? block.title
      : locale === 'sw'
        ? 'Kazi ya hati'
        : 'Document quest';
  const steps = Array.isArray(block.steps)
    ? block.steps.filter((s): s is QuestStep => Boolean(s)).slice(0, 12)
    : [];
  const deadline =
    typeof block.deadline === 'string' && block.deadline.length > 0
      ? block.deadline
      : null;
  const priority: Priority =
    block.priority === 'high' || block.priority === 'medium' || block.priority === 'low'
      ? block.priority
      : 'medium';

  return (
    <div
      data-testid="inline-block-doc-quest"
      className={`rounded-xl border bg-surface/60 p-3 ${PRIORITY_TONE[priority]}`}
    >
      <div className="flex items-center gap-2">
        <Scroll className="h-4 w-4" aria-hidden="true" />
        <p className="text-tiny font-semibold uppercase tracking-wide">
          {locale === 'sw' ? 'Kazi ya hati' : 'Document side quest'}
        </p>
      </div>
      <h3 className="mt-1 text-sm font-semibold text-foreground">{title}</h3>
      <div className="mt-1 flex flex-wrap items-center gap-3 text-tiny text-foreground/70">
        {deadline ? (
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3 w-3" aria-hidden="true" />
            {deadline}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1">
          <Flag className="h-3 w-3" aria-hidden="true" />
          {priority}
        </span>
      </div>
      {steps.length > 0 ? (
        <ol className="mt-3 space-y-1.5 text-sm">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface text-tiny font-semibold text-foreground/80">
                {i + 1}
              </span>
              <button
                type="button"
                onClick={() =>
                  onAction?.({
                    action: 'open_step',
                    payload: { title, stepIndex: i },
                  })
                }
                className="text-left text-foreground/85 hover:text-foreground"
              >
                <p>{s.label ?? `Step ${i + 1}`}</p>
                {s.source ? (
                  <p className="text-tiny italic text-foreground/60">
                    {s.source}
                  </p>
                ) : null}
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      <button
        type="button"
        onClick={() =>
          onAction?.({ action: 'start_quest', payload: { title } })
        }
        className="mt-3 inline-flex items-center justify-center rounded-md bg-foreground/10 px-3 py-1.5 text-tiny font-semibold text-foreground transition-colors hover:bg-foreground/15"
      >
        {locale === 'sw' ? 'Anza kazi' : 'Start quest'}
      </button>
    </div>
  );
}
