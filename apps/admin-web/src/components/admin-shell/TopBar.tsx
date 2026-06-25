'use client';

import { Search } from 'lucide-react';
import { useCallback, useState } from 'react';
import { ThemeToggle } from '@borjie/design-system';
import { PortalSwitcher, type PortalSwitcherLabels } from '@borjie/app-shell';
import { useLocale, pickByLocale } from '@/lib/locale';
import { EnvBadge } from './EnvBadge';

/**
 * TopBar — slim workspace header for the admin console.
 *
 * Layout follows the reference portal-workspace-header pattern:
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
 * Locale: the chrome follows the operator's ACTIVE locale, not a hardcoded
 * English. `useLocale()` reads the root server-seeded `LocaleProvider` (set
 * from the `borjie_locale` cookie in the layout), so SSR and the first
 * client paint agree — no EN-under-SW split. Every visible string (theme
 * toggle, search placeholder, sr-only label, portal-switcher labels) is
 * resolved through `pickByLocale`, single-language per locale, never both.
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
  // Active locale from the root server-seeded provider — first paint already
  // matches SSR, so threading it here introduces no split-brain frame.
  const locale = useLocale();

  // Localized portal-switcher copy. The package ships English defaults and
  // requires the consumer to inject `sw` strings when the active locale is
  // `sw` — otherwise the switcher would render English chrome under a Swahili
  // console (the mixing the canon forbids).
  const portalLabels: PortalSwitcherLabels = {
    owner: pickByLocale(locale, { en: 'Owner Cockpit', sw: 'Kifaa cha Mmiliki' }),
    admin: pickByLocale(locale, { en: 'Borjie Console', sw: 'Konsoli ya Borjie' }),
    switch: pickByLocale(locale, { en: 'Switch portal', sw: 'Badilisha mlango' }),
  };

  // The admin chrome has no dedicated search route; the universal Cmd-K
  // palette IS the search surface. Submitting the header field opens it
  // by dispatching the same Cmd-K shortcut the palette already listens
  // for (see CommandPalette `useGlobalShortcut`). Previously this form
  // was a no-op (`preventDefault` + unused query).
  const openCommandPalette = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
    );
  }, []);

  return (
    <header
      role="banner"
      className="sticky top-0 z-30 flex items-center gap-4 border-b border-border bg-background/85 px-6 py-3 backdrop-blur lg:px-10"
    >
      <EnvBadge {...(env ? { env } : {})} />

      <PortalSwitcher
        current="admin"
        ownerUrl={ownerUrl}
        adminUrl={adminUrl}
        labels={portalLabels}
      />

      <form
        role="search"
        className="relative flex-1 max-w-xl"
        onSubmit={(e) => {
          e.preventDefault();
          openCommandPalette();
        }}
      >
        <label htmlFor="admin-search" className="sr-only">
          {pickByLocale(locale, {
            en: 'Search tenants, audit, cases',
            sw: 'Tafuta wateja, ukaguzi, kesi',
          })}
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
          placeholder={pickByLocale(locale, {
            en: 'Search (press Enter for ⌘K)…',
            sw: 'Tafuta (bonyeza Enter kwa ⌘K)…',
          })}
          className="w-full rounded-md border border-border bg-surface-sunken pl-9 pr-3 py-1.5 text-sm text-foreground placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-signal-500/30"
        />
      </form>

      <ThemeToggle locale={locale} />

      {identity ? <div className="ml-2 shrink-0">{identity}</div> : null}
    </header>
  );
}
