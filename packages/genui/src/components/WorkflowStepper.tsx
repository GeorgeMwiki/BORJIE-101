'use client';

/**
 * 7. workflow — horizontal stepper for multi-step workflows.
 *
 * shadcn Stepper pattern, no external deps. Renders steps left→right
 * with status colours (pending, running, done, failed).
 */

import type { AgUiUiPartByKind } from '../types';
import { Frame, GenUiError } from './Frame';
import { WorkflowPartSchema } from '../schemas';

export type WorkflowStepperProps = AgUiUiPartByKind<'workflow'>;

const STATUS_COLOUR: Record<string, string> = {
  pending: 'border-border text-muted-foreground',
  running: 'border-blue-500 text-blue-600',
  done: 'border-green-500 text-green-700',
  failed: 'border-red-500 text-red-700',
};

const STATUS_SYMBOL: Record<string, string> = {
  pending: '○',
  running: '●',
  done: '✓',
  failed: '✕',
};

export function WorkflowStepper(props: WorkflowStepperProps): JSX.Element {
  const parsed = WorkflowPartSchema.safeParse(props);
  if (!parsed.success) {
    return (
      <GenUiError
        kind="workflow"
        message={parsed.error.issues.map((i) => i.message).join('; ')}
      />
    );
  }
  if (props.currentIndex >= props.steps.length) {
    return <GenUiError kind="workflow" message="currentIndex out of range" />;
  }

  return (
    <Frame kind="workflow" {...(props.title ? { title: props.title } : {})}>
      <ol className="flex items-center gap-2 flex-wrap text-xs">
        {props.steps.map((s, i) => {
          const isCurrent = i === props.currentIndex;
          const colour = STATUS_COLOUR[s.status] ?? STATUS_COLOUR.pending;
          return (
            <li
              key={i}
              className={`flex items-center gap-1 rounded border px-2 py-1 ${colour} ${
                isCurrent ? 'ring-1 ring-primary' : ''
              }`}
            >
              <span aria-hidden>{STATUS_SYMBOL[s.status]}</span>
              <span>{s.label}</span>
            </li>
          );
        })}
      </ol>
    </Frame>
  );
}
