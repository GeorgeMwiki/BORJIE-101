import type { ReactNode } from 'react';
import { PageHeader } from '@borjie/design-system';
import type { InternalScreen } from '@/lib/internal/screens';

interface ScreenShellProps {
  readonly screen: InternalScreen;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
  readonly stub?: boolean;
}

/**
 * Common header + container for every I-W-XX stub page. The header now
 * routes through the design-system `PageHeader` (breadcrumb + title +
 * description + actions), with the screen-id eyebrow kept above it (a
 * console affordance `PageHeader` does not model). The public API
 * (`screen, children, actions, stub`) is unchanged so every page-level
 * file keeps compiling verbatim and stays under the route budget.
 */
export function ScreenShell({ screen, children, actions, stub = false }: ScreenShellProps): JSX.Element {
  return (
    <main id="main-content" className="mx-auto max-w-7xl px-6 py-10">
      <p className="mb-1 text-caption uppercase tracking-widest text-signal-500">{screen.id}</p>
      <PageHeader
        title={screen.title}
        description={screen.intent}
        breadcrumbs={[{ label: 'Console', href: '/internal' }, { label: screen.id }]}
        actions={actions}
      />

      <section className="space-y-6">{children}</section>

      {stub ? (
        <footer className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground">
          Stub page — data above is illustrative. Wire to live services in
          subsequent build phases.
        </footer>
      ) : null}
    </main>
  );
}
