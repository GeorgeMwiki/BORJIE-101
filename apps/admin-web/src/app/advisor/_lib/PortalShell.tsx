/**
 * PortalShell — local server-component shell for the advisor surface.
 *
 * The wider `@borjie/design-system` does not yet expose a
 * `<PortalShell>`, so we inline a thin one here that re-uses the
 * existing `StaffNav` + `StaffIdentityStrip` chrome. This keeps the
 * 9 advisor pages visually consistent with the rest of HQ.
 */

import type { ReactNode } from 'react';
import { StaffNav } from '@/components/StaffNav';
import { StaffIdentityStrip } from '@/components/StaffIdentityStrip';

export interface PortalShellProps {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}

export function PortalShell({
  title,
  description,
  children,
}: PortalShellProps) {
  return (
    <div className="flex min-h-screen">
      <StaffNav />
      <main id="main-content" className="flex-1 p-10">
        <header className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-display text-foreground mb-1">
              {title}
            </h1>
            <p className="text-sm text-neutral-400 max-w-2xl">{description}</p>
          </div>
          <StaffIdentityStrip />
        </header>
        {children}
      </main>
    </div>
  );
}
