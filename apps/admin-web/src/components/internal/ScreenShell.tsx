import Link from 'next/link';
import type { ReactNode } from 'react';
import type { InternalScreen } from '@/lib/internal/screens';

interface ScreenShellProps {
  readonly screen: InternalScreen;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
  readonly stub?: boolean;
}

/**
 * Common header + container for every I-W-XX stub page. Keeps the
 * page-level files tiny so each stub stays well under the 200-line
 * route budget.
 */
export function ScreenShell({ screen, children, actions, stub = false }: ScreenShellProps): JSX.Element {
  return (
    <main id="main-content" className="mx-auto max-w-7xl px-6 py-10">
      <nav aria-label="Breadcrumb" className="mb-4 text-xs text-neutral-500">
        <Link href="/internal" className="hover:text-foreground transition-colors">
          Console
        </Link>
        <span aria-hidden="true" className="mx-2">/</span>
        <span className="text-neutral-400">{screen.id}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          <p className="text-[0.62rem] uppercase tracking-widest text-signal-500 mb-1">
            {screen.id}
          </p>
          <h1 className="text-3xl font-display text-foreground mb-2">
            {screen.title}
          </h1>
          <p className="text-sm text-neutral-400 max-w-2xl">{screen.intent}</p>
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>

      <section className="space-y-6">{children}</section>

      {stub ? (
        <footer className="mt-12 pt-6 border-t border-border text-xs text-neutral-500">
          Stub page — data above is illustrative. Wire to live services in
          subsequent build phases.
        </footer>
      ) : null}
    </main>
  );
}
