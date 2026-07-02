/**
 * Stepper — multi-step progress indicator (LitFin polish bar).
 *
 * Renders an ordered list of steps in three states — complete, current,
 * upcoming — with a numbered (or check) node, label, optional description,
 * and connector line. Copper (`--gradient-primary` / `bg-primary`) marks
 * done + active; muted marks upcoming.
 *
 * A11y:
 *   - Wrapped in `<nav>` with a caller-supplied localized `label`
 *     (aria-label) so the region is named without a hardcoded string.
 *   - The step list is an ordered `<ol>`; the active step carries
 *     `aria-current="step"`.
 *   - Completed / upcoming state is conveyed by the caller-localized
 *     `statusLabel` on each step (visually-hidden), not by color alone
 *     (WCAG 1.4.1 — do not rely on color).
 *   - The numbered node is `aria-hidden`; meaning comes from the label +
 *     status text.
 *
 * Copy: labels, descriptions, the nav name, and per-step status text are
 * ALL caller-supplied and localized. Zero hardcoded user-facing strings.
 */
import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../lib/utils';

export type StepStatus = 'complete' | 'current' | 'upcoming';

export interface StepperStep {
  /** Stable id (used as React key). */
  readonly id: string;
  /** Localized step label. */
  readonly label: string;
  /** Optional localized secondary line. */
  readonly description?: string;
  /**
   * Localized status text for assistive tech (e.g. "completed",
   * "current step", "not started"). Rendered visually-hidden so state is
   * not conveyed by color alone. Optional; omit to rely on aria-current.
   */
  readonly statusLabel?: string;
}

export interface StepperProps {
  readonly steps: readonly StepperStep[];
  /** Zero-based index of the current step. */
  readonly current: number;
  /** Localized accessible name for the nav region. */
  readonly label: string;
  /** Layout direction. Vertical suits sidebars; horizontal suits headers. */
  readonly orientation?: 'horizontal' | 'vertical';
  readonly className?: string;
}

function statusOf(index: number, current: number): StepStatus {
  if (index < current) return 'complete';
  if (index === current) return 'current';
  return 'upcoming';
}

const nodeClasses: Record<StepStatus, string> = {
  complete: 'bg-primary text-primary-foreground border-primary',
  current: 'bg-background text-primary border-primary shadow-glow',
  upcoming: 'bg-background text-muted-foreground border-border',
};

const labelClasses: Record<StepStatus, string> = {
  complete: 'text-foreground',
  current: 'text-foreground font-medium',
  upcoming: 'text-muted-foreground',
};

const connectorClasses: Record<StepStatus, string> = {
  complete: 'bg-primary',
  current: 'bg-border',
  upcoming: 'bg-border',
};

interface StepNodeProps {
  readonly index: number;
  readonly status: StepStatus;
}

const StepNode: React.FC<StepNodeProps> = ({ index, status }) => (
  <span
    aria-hidden="true"
    className={cn(
      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium',
      'transition-colors duration-[var(--duration-base)] ease-[var(--ease-out)]',
      nodeClasses[status],
    )}
  >
    {status === 'complete' ? <Check className="h-4 w-4" /> : index + 1}
  </span>
);

export const Stepper: React.FC<StepperProps> = ({
  steps,
  current,
  label,
  orientation = 'horizontal',
  className,
}) => {
  const isVertical = orientation === 'vertical';

  return (
    <nav aria-label={label} className={className}>
      <ol
        className={cn(
          'flex',
          isVertical ? 'flex-col gap-0' : 'items-start',
        )}
      >
        {steps.map((step, index) => {
          const status = statusOf(index, current);
          const isLast = index === steps.length - 1;
          return (
            <li
              key={step.id}
              aria-current={status === 'current' ? 'step' : undefined}
              className={cn(
                'flex',
                isVertical ? 'gap-3' : 'flex-1 flex-col items-center text-center',
                !isVertical && !isLast && 'relative',
              )}
            >
              {isVertical ? (
                <div className="flex flex-col items-center">
                  <StepNode index={index} status={status} />
                  {!isLast ? (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'my-1 w-px flex-1',
                        connectorClasses[status],
                      )}
                    />
                  ) : null}
                </div>
              ) : (
                <div className="flex w-full items-center">
                  <span className="flex-1" aria-hidden="true" />
                  <StepNode index={index} status={status} />
                  {!isLast ? (
                    <span
                      aria-hidden="true"
                      className={cn('h-px flex-1', connectorClasses[status])}
                    />
                  ) : (
                    <span className="flex-1" aria-hidden="true" />
                  )}
                </div>
              )}

              <div className={cn(isVertical ? 'pb-6 pt-0.5' : 'mt-2')}>
                <span className={cn('block text-sm', labelClasses[status])}>
                  {step.label}
                </span>
                {step.description ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {step.description}
                  </span>
                ) : null}
                {step.statusLabel ? (
                  <span className="sr-only">{step.statusLabel}</span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
