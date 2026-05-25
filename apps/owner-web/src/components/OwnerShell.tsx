import type { ReactNode } from 'react';
import { OwnerSidebar } from './OwnerSidebar';
import { OwnerTopBar } from './OwnerTopBar';

interface OwnerShellProps {
  readonly children: ReactNode;
}

/**
 * The owner-cockpit chrome — sidebar + top bar + scroll area.
 *
 * Every owner route renders through this shell so the navigation,
 * site selector, language toggle and identity are constant. The
 * inner `<main>` is the per-page surface.
 */
export async function OwnerShell({ children }: OwnerShellProps) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <OwnerSidebar />
      <div className="flex flex-1 flex-col">
        <OwnerTopBar />
        <main id="main-content" className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
