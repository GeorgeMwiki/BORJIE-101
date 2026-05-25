'use client';

/**
 * Shared loading / error / empty surfaces for every advisor page.
 *
 * Kept tiny and dependency-free so we never have to remember to wire
 * up a `<QueryClientProvider>` to render a spinner.
 */

import type { ReactNode } from 'react';

export function AdvisorLoading({ label = 'Calling advisor…' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="platform-card flex items-center gap-3"
    >
      <span
        className="inline-block w-3 h-3 rounded-full bg-signal-500 animate-pulse"
        aria-hidden
      />
      <span className="text-sm text-neutral-300">{label}</span>
    </div>
  );
}

export function AdvisorError({ message }: { message: string }) {
  return (
    <div role="alert" className="platform-card-degraded">
      <div className="text-xs uppercase tracking-wider text-warning mb-1">
        Advisor unavailable
      </div>
      <div className="text-sm text-neutral-200">{message}</div>
    </div>
  );
}

export function AdvisorEmpty({
  title,
  hint,
}: {
  readonly title: string;
  readonly hint?: string;
}) {
  return (
    <div className="platform-card text-sm text-neutral-400">
      <div className="font-medium text-foreground mb-1">{title}</div>
      {hint ? <div>{hint}</div> : null}
    </div>
  );
}

/**
 * Tiny field-label wrapper so the form blocks stay consistent without
 * dragging in the heavier `<FormField>` from the design-system (which
 * itself depends on `react-hook-form` we don't want here).
 */
export function FieldLabel({
  htmlFor,
  label,
  hint,
  children,
}: {
  readonly htmlFor: string;
  readonly label: string;
  readonly hint?: string;
  readonly children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="block text-xs uppercase tracking-wider text-neutral-400 mb-1">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="block text-[0.7rem] text-neutral-500 mt-1">
          {hint}
        </span>
      ) : null}
    </label>
  );
}
