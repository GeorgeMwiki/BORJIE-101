/**
 * Empty-state placeholder. Rendered when a screen has no live data to
 * show — typically because the backing gateway endpoint is not yet
 * wired or the session is unauthenticated. Replaces what used to be a
 * pre-rendered mock dataset.
 */
interface EmptyStateProps {
  readonly title: string;
  readonly description: string;
  readonly hint?: string;
}

export function EmptyState({ title, description, hint }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface/40 px-6 py-12 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-md text-xs text-neutral-400">{description}</p>
      {hint ? <p className="mt-1 text-badge text-neutral-500">{hint}</p> : null}
    </div>
  );
}
