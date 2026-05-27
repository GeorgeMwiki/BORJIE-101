'use client';

import type { ReactNode } from 'react';

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly subLabel: string;
  readonly required?: boolean;
  readonly error?: string;
  readonly children: ReactNode;
}

/**
 * Form field shell — bilingual label + sub-label + inline error.
 *
 * The marketing app's existing PilotForm uses a similar pattern with
 * mono-caption labels above the input; the buyer signup form layers
 * a bilingual second line below the main label for sw/en clarity
 * and an `aria-describedby` link to the inline error for SR users.
 */
export function Field({
  id,
  label,
  subLabel,
  required,
  error,
  children,
}: FieldProps) {
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="space-y-1">
      <label
        htmlFor={id}
        className="block text-xs font-medium text-foreground/80"
      >
        <span>{label}</span>
        {required ? (
          <span className="ml-0.5 text-signal-500" aria-hidden="true">
            *
          </span>
        ) : null}
        <span className="ml-2 font-mono text-meta uppercase tracking-widest text-foreground/50">
          {subLabel}
        </span>
      </label>
      <div aria-describedby={errorId}>{children}</div>
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
