'use client';

import { Bell, Search } from 'lucide-react';
import { useState } from 'react';
import { ThemeToggle } from '@borjie/design-system';
import { PortalSwitcher } from '@borjie/app-shell';
import { EnvBadge } from './EnvBadge';

/**
 * TopBar — slim workspace header for the admin console.
 *
 * Layout mirrors LitFin's PortalWorkspaceHeader pattern:
 *   [ env badge ] [ portal switcher ] [ search ]      [ alerts ] [ persona ]
 *
 * The cross-portal switcher (from `@borjie/app-shell`) lets Borjie staff
 * jump between this console and the owner cockpit; rather than stacking a
 * second `AppTopBar` banner on top of this one, the switcher is slotted
 * directly into the existing header so the suite reads as one product
 * with a single chrome bar.
 *
 * The persona chip is rendered by the server-side `<StaffIdentityStrip />`
 * slotted in from the layout — this client component owns the search
 * field and notification bell only. Keeps the file small and avoids
 * pulling Supabase calls into a client boundary.
 *
 * Locale: admin-web chrome is English-only (no Swahili dictionary ships
 * for the console), so the switcher's built-in English `labels` are used
 * — no Swahili literal is hard-coded here, keeping the locale-purity
 * guard green.
 */

export interface TopBarProps {
  /** Server-rendered identity strip. Slotted as a prop so the client
   *  layer does not have to know about Supabase. */
  readonly identity?: React.ReactNode;
  /** Optional override for env badge. */
  readonly env?: string;
  /** Absolute origin of the owner cockpit (owner-web). Resolved on the
   *  server in `AdminShell` so this client layer never reads env. */
  readonly ownerUrl: string;
  /** Absolute origin of this Borjie Console (admin-web). */
  readonly adminUrl: string;
}

export function TopBar({ identity, env, ownerUrl, adminUrl }: TopBarProps): JSX.Element {
  const [query, setQuery] = useState('');
  return (
    <header
      role="banner"
      className="sticky top-0 z-30 flex items-center gap-4 border-b border-border bg-background/85 px-6 py-3 backdrop-blur lg:px-10"
    >
      <EnvBadge {...(env ? { env } : {})} />

      <PortalSwitcher current="admin" ownerUrl={ownerUrl} adminUrl={adminUrl} />

      <form
        role="search"
        className="relative flex-1 max-w-xl"
        onSubmit={(e) => e.preventDefault()}
      >
        <label htmlFor="admin-search" className="sr-only">
          Search tenants, audit, cases
        </label>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500"
          aria-hidden="true"
        />
        <input
          id="admin-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tenants, audit, cases…"
          className="w-full rounded-md border border-border bg-surface-sunken pl-9 pr-3 py-1.5 text-sm text-foreground placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-signal-500/30"
        />
      </form>

      <button
        type="button"
        aria-label="Notifications"
        className="relative rounded-md border border-border bg-surface-sunken p-1.5 text-neutral-400 transition-colors hover:bg-surface hover:text-signal-500"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 inline-flex h-2 w-2 rounded-full bg-signal-500 ring-2 ring-background"
        />
      </button>

      <ThemeToggle locale="en" />

      {identity ? <div className="ml-2 shrink-0">{identity}</div> : null}
    </header>
  );
}
