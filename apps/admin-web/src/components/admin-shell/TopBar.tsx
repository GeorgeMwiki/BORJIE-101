'use client';

import { Bell, Search } from 'lucide-react';
import { useState } from 'react';
import { EnvBadge } from './EnvBadge';

/**
 * TopBar — slim workspace header for the admin console.
 *
 * Layout mirrors LitFin's PortalWorkspaceHeader pattern:
 *   [ env badge ]  [ global search ]                  [ alerts ] [ persona chip ]
 *
 * The persona chip is rendered by the server-side `<StaffIdentityStrip />`
 * slotted in from the layout — this client component owns the search
 * field and notification bell only. Keeps the file small and avoids
 * pulling Supabase calls into a client boundary.
 */

export interface TopBarProps {
  /** Server-rendered identity strip. Slotted as a prop so the client
   *  layer does not have to know about Supabase. */
  readonly identity?: React.ReactNode;
  /** Optional override for env badge. */
  readonly env?: string;
}

export function TopBar({ identity, env }: TopBarProps): JSX.Element {
  const [query, setQuery] = useState('');
  return (
    <header
      role="banner"
      className="sticky top-0 z-30 flex items-center gap-4 border-b border-border bg-background/85 px-6 py-3 backdrop-blur lg:px-10"
    >
      <EnvBadge {...(env ? { env } : {})} />

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

      {identity ? <div className="ml-2 shrink-0">{identity}</div> : null}
    </header>
  );
}
