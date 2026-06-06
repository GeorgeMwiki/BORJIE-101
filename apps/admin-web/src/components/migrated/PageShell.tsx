import { ReactNode } from 'react';

interface PageShellProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly children: ReactNode;
}

/**
 * Shared header wrapper for HQ pages migrated from the deprecated
 * admin-portal.
 *
 * AD-6 fix: this wrapper used to render its own `<StaffNav />` plus a
 * `flex min-h-screen` + `<main id="main-content">` + identity strip.
 * Every page that uses it is already mounted inside `AdminShell` (left
 * rail + sticky top bar with the persona chip + `<main>` content
 * frame), so the old shell produced a DOUBLE sidebar, a duplicate
 * identity strip, and a duplicate `main-content` id on ~20 pages. It
 * now renders only the page header — matching the `PageHero` rhythm —
 * and leaves all chrome to AdminShell.
 *
 * Kept `async` so the returned element type is identical for every
 * caller (some render it from async server components).
 */
export async function PageShell({
  title,
  subtitle,
  children,
}: PageShellProps) {
  return (
    <div>
      <header className="mb-8 border-b border-border pb-6">
        <h1 className="text-3xl font-display text-foreground mb-2">{title}</h1>
        {subtitle ? (
          <p className="text-sm text-neutral-400 max-w-xl">{subtitle}</p>
        ) : null}
      </header>
      {children}
    </div>
  );
}
