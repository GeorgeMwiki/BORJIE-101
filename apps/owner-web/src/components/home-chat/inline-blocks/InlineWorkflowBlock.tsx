'use client';

/**
 * InlineWorkflowBlock — checklist / runbook with live status.
 *
 * Schema source: `packages/owner-os-tabs/src/rich-inline-blocks.ts` →
 * `inlineWorkflowSchema`. Renders an ordered checklist with status
 * dots (pending / in_progress / done / blocked). Each step can carry a
 * one-tap micro-action that fires `onAction` on click.
 */

import type { ReactElement } from 'react';
import { Check, Circle, AlertCircle, Loader2 } from 'lucide-react';

type StepStatus = 'pending' | 'in_progress' | 'done' | 'blocked';

interface ActionRef {
  readonly label?: { readonly en?: string; readonly sw?: string };
  readonly kind?: 'micro_action_card';
  readonly payload?: Record<string, unknown>;
}

interface WorkflowStep {
  readonly id?: string;
  readonly label?: { readonly en?: string; readonly sw?: string };
  readonly status?: StepStatus;
  readonly blockedReason?: { readonly en?: string; readonly sw?: string };
  readonly action?: ActionRef;
}

export interface InlineWorkflowBlock {
  readonly type: 'inline_workflow';
  readonly title?: { readonly en?: string; readonly sw?: string };
  readonly steps?: ReadonlyArray<WorkflowStep>;
  readonly [extra: string]: unknown;
}

export interface InlineWorkflowBlockProps {
  readonly block: InlineWorkflowBlock;
  readonly locale: 'sw' | 'en';
  readonly onAction?: (event: {
    readonly action: string;
    readonly payload: Record<string, unknown>;
  }) => void;
}

function localised(
  value: { readonly en?: string; readonly sw?: string } | undefined,
  locale: 'sw' | 'en',
  fallback: string,
): string {
  if (!value) return fallback;
  return (locale === 'sw' ? value.sw : value.en) ?? value.en ?? value.sw ?? fallback;
}

function StatusIcon({ status }: { readonly status: StepStatus }): ReactElement {
  if (status === 'done')
    return (
      <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
    );
  if (status === 'in_progress')
    return (
      <Loader2
        className="h-3.5 w-3.5 animate-spin text-warning"
        aria-hidden="true"
      />
    );
  if (status === 'blocked')
    return (
      <AlertCircle className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
    );
  return (
    <Circle className="h-3.5 w-3.5 text-foreground/40" aria-hidden="true" />
  );
}

export function InlineWorkflowBlock({
  block,
  locale,
  onAction,
}: InlineWorkflowBlockProps): ReactElement {
  const title = localised(
    block.title,
    locale,
    locale === 'sw' ? 'Mtiririko' : 'Workflow',
  );
  const steps = Array.isArray(block.steps)
    ? block.steps.filter((s): s is WorkflowStep => Boolean(s)).slice(0, 20)
    : [];

  return (
    <div
      data-testid="inline-block-inline-workflow"
      className="rounded-xl border border-border bg-surface/60 p-3"
    >
      <p className="text-tiny font-semibold uppercase tracking-wide text-foreground/70">
        {title}
      </p>
      <ol className="mt-3 space-y-2">
        {steps.map((step, i) => {
          const id = typeof step.id === 'string' ? step.id : `step_${i}`;
          const status: StepStatus = step.status ?? 'pending';
          const label = localised(step.label, locale, `Step ${i + 1}`);
          const blockedReason = localised(step.blockedReason, locale, '');
          const action = step.action;
          const actionLabel = localised(action?.label, locale, '');

          return (
            <li
              key={id}
              className="flex items-start gap-2.5"
              data-status={status}
            >
              <span className="mt-0.5">
                <StatusIcon status={status} />
              </span>
              <div className="flex-1">
                <p
                  className={`text-sm ${status === 'done' ? 'text-foreground/60 line-through' : 'text-foreground'}`}
                >
                  {label}
                </p>
                {status === 'blocked' && blockedReason ? (
                  <p className="mt-0.5 text-tiny text-destructive">
                    {blockedReason}
                  </p>
                ) : null}
                {action && actionLabel ? (
                  <button
                    type="button"
                    onClick={() =>
                      onAction?.({
                        action: 'workflow_step_action',
                        payload: {
                          stepId: id,
                          ...(action.payload && typeof action.payload === 'object'
                            ? action.payload
                            : {}),
                        },
                      })
                    }
                    className="mt-1 inline-flex items-center rounded-md border border-warning/40 bg-warning/[0.08] px-2 py-0.5 text-tiny font-semibold text-warning transition-colors hover:bg-warning/[0.15]"
                  >
                    {actionLabel}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
