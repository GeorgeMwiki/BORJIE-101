'use client';

/**
 * Frame — the shared title + bordered container every primitive sits
 * inside. Keeps Tailwind classnames OWNED BY THE PRIMITIVE (never by
 * the LLM), per the R2 anti-pattern guard.
 */

import type { ReactNode } from 'react';

export interface FrameProps {
  readonly title?: string;
  readonly kind: string;
  readonly children: ReactNode;
}

export function Frame({ title, kind, children }: FrameProps): JSX.Element {
  return (
    <div
      className="rounded-lg border border-border bg-surface p-3 my-2"
      data-genui-kind={kind}
    >
      {title ? (
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
      ) : null}
      <div>{children}</div>
    </div>
  );
}

export function GenUiError({
  kind,
  message,
}: {
  readonly kind: string;
  readonly message: string;
}): JSX.Element {
  return (
    <div
      className="rounded border border-destructive bg-destructive/5 p-2 my-2 text-xs text-destructive"
      data-genui-error={kind}
    >
      <strong className="font-medium">[{kind}] render error:</strong> {message}
    </div>
  );
}
