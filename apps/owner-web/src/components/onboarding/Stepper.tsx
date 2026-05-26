'use client';

import { Check } from 'lucide-react';

export interface StepperStep {
  readonly id: string;
  readonly label: string;
  readonly labelSw: string;
}

interface StepperProps {
  readonly steps: ReadonlyArray<StepperStep>;
  readonly current: number;
}

/**
 * Horizontal progress stepper for the onboarding wizard.
 *
 * Renders one circle per step. Completed steps show a check, the
 * active step is highlighted in `warning`, and pending steps are
 * muted. Bilingual labels (English + Swahili) sit underneath the
 * active step so the owner always sees both languages.
 */
export function Stepper({ steps, current }: StepperProps) {
  return (
    <ol className="flex w-full items-start gap-2" aria-label="Onboarding progress">
      {steps.map((step, index) => {
        const isCompleted = index < current;
        const isActive = index === current;
        return (
          <li key={step.id} className="flex flex-1 flex-col items-center gap-2">
            <div className="flex w-full items-center gap-2">
              <span
                aria-current={isActive ? 'step' : undefined}
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${
                  isCompleted
                    ? 'border-success bg-success text-background'
                    : isActive
                      ? 'border-warning bg-warning-subtle/40 text-warning'
                      : 'border-border bg-surface text-neutral-500'
                }`}
              >
                {isCompleted ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              {index < steps.length - 1 ? (
                <span
                  className={`h-px flex-1 ${
                    isCompleted ? 'bg-success' : 'bg-border'
                  }`}
                />
              ) : null}
            </div>
            <div className="w-full text-center">
              <p
                className={`text-[11px] font-medium ${
                  isActive ? 'text-foreground' : 'text-neutral-500'
                }`}
              >
                {step.label}
              </p>
              <p
                className={`text-[10px] italic ${
                  isActive ? 'text-neutral-400' : 'text-neutral-600'
                }`}
              >
                {step.labelSw}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
