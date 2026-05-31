'use client';

import type { ReactNode } from 'react';

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly required?: boolean;
  readonly error?: string;
  readonly children: ReactNode;
}

/**
 * Form field shell — label + inline error.
 *
 * The marketing app's existing PilotForm uses a similar pattern with
 * mono-caption labels above the input. Labels render in the active
 * locale only (absolute en/sw toggle — no second-language line) and
 * link to the inline error via `aria-describedby` for SR users.
 */
export function Field({
  id,
  label,
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
