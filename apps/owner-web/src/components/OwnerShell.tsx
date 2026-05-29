import type { ReactNode } from 'react';
import { getOwnerSession } from '@/lib/session';
import { OwnerProviders } from './owner-shell/OwnerProviders';
import { Sidebar } from './owner-shell/Sidebar';
import { TopBar } from './owner-shell/TopBar';
import { TenantRail } from './TenantRail';

interface OwnerShellProps {
  readonly children: ReactNode;
}

/**
 * Owner-cockpit shell — sidebar + top bar + scrollable main.
 *
 * Mirrors LitFin's `(borrower)/layout.tsx` portal-shell layout:
 *   - Outer `flex h-screen` with a sidebar on the left and a flex
 *     column main region on the right.
 *   - Top bar is sticky and contains breadcrumbs + chat / bell /
 *     persona controls.
 *   - Inner content area scrolls independently and wraps each page in
 *     a centred `max-w-7xl` content frame (`px-6 lg:px-8 py-8`).
 *
 * Server component — resolves the owner session once and hands the
 * tenant / identity strings down to the small client islands
 * (Sidebar / TopBar) that need them. The page itself renders inside
 * the `<main>` slot.
 */
export async function OwnerShell({ children }: OwnerShellProps) {
  const session = await getOwnerSession();
  return (
    <OwnerProviders>
      <div className="relative flex min-h-screen bg-background text-foreground">
        {/* Discord-style left rail — auto-hides when the user is linked
            to ≤ 1 tenant so single-tenant owners see no visual noise.
            See `Docs/ROADMAP.md` R12 (SHIPPED 2026-05-29). */}
        <TenantRail />
        <Sidebar
          tenantName={session.tenant.tradingName}
          languagePreference={session.languagePreference}
        />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar
            fullName={session.fullName}
            tenantName={session.tenant.tradingName}
            languagePreference={session.languagePreference}
          />
          <main
            id="main-content"
            tabIndex={-1}
            className="flex-1 overflow-y-auto"
          >
            <div className="mx-auto w-full max-w-7xl px-6 py-8 lg:px-8">
              {children}
            </div>
          </main>
        </div>
      </div>
    </OwnerProviders>
  );
}
