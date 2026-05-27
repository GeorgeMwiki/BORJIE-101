import { getScreenBySlug } from '@/lib/screens';

interface ScreenHeaderProps {
  readonly slug: string;
}

/**
 * Per-screen header strip — title + Swahili gloss + spec ID + intent.
 *
 * Every route stub in (routes)/ renders this at the top so the
 * surface stays self-describing during the bootstrap phase. The spec
 * ID (O-W-NN) is intentionally visible while we wire real
 * functionality, so reviewers can match each surface against
 * UI_SCREEN_CATALOGUE.md without leaving the page.
 */
export function ScreenHeader({ slug }: ScreenHeaderProps) {
  const screen = getScreenBySlug(slug);
  if (!screen) {
    return (
      <header className="border-b border-border px-8 py-6">
        <h1 className="font-display text-2xl text-destructive">
          Unknown screen: {slug}
        </h1>
      </header>
    );
  }
  return (
    <header className="border-b border-border px-8 py-6">
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs text-neutral-500">{screen.id}</span>
        <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-badge text-neutral-400">
          {screen.persona}
        </span>
      </div>
      <h1 className="mt-1 font-display text-3xl text-foreground">
        {screen.title}
      </h1>
      <p className="mt-0.5 text-xs italic text-neutral-500">
        {screen.titleSw}
      </p>
      <p className="mt-3 max-w-3xl text-sm text-neutral-300">
        {screen.intent}
      </p>
    </header>
  );
}
