import { ReactNode } from 'react';
import { StaffNav } from '@/components/StaffNav';
import { StaffIdentityStrip } from '@/components/StaffIdentityStrip';

interface PageShellProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly children: ReactNode;
}

/**
 * Shared server-component layout for HQ pages migrated from the
 * deprecated admin-portal. Wraps the page body with the same StaffNav
 * and identity strip used by /industry et al., keeping migrated pages
 * visually consistent with the rest of HQ.
 *
 * The `children` slot can be a client component — composing a server
 * shell around a client island is the supported pattern.
 */
export async function PageShell({
  title,
  subtitle,
  children,
}: PageShellProps) {
  return (
    <div className="flex min-h-screen">
      <StaffNav />
      <main id="main-content" tabIndex={-1} className="flex-1 p-10">
        <header className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-display text-foreground mb-2">{title}</h1>
            {subtitle ? (
              <p className="text-sm text-neutral-400 max-w-xl">{subtitle}</p>
            ) : null}
          </div>
          <StaffIdentityStrip />
        </header>
        {children}
      </main>
    </div>
  );
}
