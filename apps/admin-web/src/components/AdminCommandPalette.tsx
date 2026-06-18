'use client';

/**
 * AdminCommandPalette - mounts the universal Cmd-K palette for the
 * admin console with curated admin catalog: Navigate (every admin
 * route), Actions (top admin verbs), Settings, Sign out.
 *
 * Symmetrical sibling of `apps/owner-web/src/components/OwnerCommandPalette.tsx`.
 */

import type { ReactElement } from 'react';
import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { CommandPalette, type CommandItem } from '@borjie/design-system';
import { openAdminBulkDrawer } from './superpowers';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

// Every route below resolves to a real page in `app/`. The earlier
// catalog shipped eight slugs that 404'd (intelligence-corpus,
// compliance, audit-logs, feature-flags, an /internal/ai-costs that
// lives at the top level, plus incidents/settings pages that were never
// built). Corrected to the live slugs; entries with no real page were
// dropped, and Sign out now calls the real auth flow instead of routing
// to a dead /sign-out URL.
const ADMIN_NAV_ROUTES: ReadonlyArray<{
  readonly route: string;
  readonly label: string;
}> = [
  { route: '/internal', label: 'Internal home' },
  { route: '/internal/tenants', label: 'Tenants' },
  { route: '/internal/corpus', label: 'Intelligence corpus' },
  { route: '/internal/prompts', label: 'Prompt registry' },
  { route: '/internal/models', label: 'Model registry' },
  { route: '/internal/compliance-queue', label: 'Compliance review' },
  { route: '/internal/audit-log', label: 'Audit logs' },
  { route: '/internal/killswitch', label: 'Kill switch' },
  { route: '/internal/flags', label: 'Feature flags' },
  { route: '/ai-costs', label: 'AI costs' },
  // Fully gateway-backed (GET /admin/subscriptions) but previously had no nav
  // door anywhere — reachable only by typing the URL. Surfaced here.
  { route: '/platform/subscriptions', label: 'Subscriptions' },
];

export function AdminCommandPalette(): ReactElement {
  const router = useRouter();

  // Mirror SignOutButton's flow: revoke the Supabase session, then
  // bounce to /sign-in and refresh so middleware re-runs. There is no
  // /sign-out route, so navigating there (the previous behaviour) left
  // the operator on a 404 still signed in.
  const handleSignOut = useCallback(async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } finally {
      router.replace('/sign-in');
      router.refresh();
    }
  }, [router]);

  const items = useMemo<ReadonlyArray<CommandItem>>(() => {
    const out: CommandItem[] = [];

    for (const nav of ADMIN_NAV_ROUTES) {
      out.push({
        id: `nav_${nav.route}`,
        kind: 'navigate',
        label: nav.label,
        hint: nav.route,
        keywords: [nav.route, nav.label.toLowerCase()],
        onSelect: () => router.push(nav.route),
      });
    }

    // Wave SUPERPOWERS — bulk-action shortcut. Cmd+Shift+B opens the
    // drawer directly; exposing the verb in the palette lets it land in
    // fuzzy search + the `recent` bucket once used.
    out.push({
      id: 'action_bulk_action',
      kind: 'action',
      label: 'Bulk action (Cmd+Shift+B)',
      hint: 'suspend / reactivate / export-regulator-pack / reindex…',
      keywords: [
        'bulk',
        'suspend',
        'reactivate',
        'export',
        'regulator',
        'killswitch',
        'feature flag',
      ],
      onSelect: () => openAdminBulkDrawer(),
    });

    // Settings entry dropped: there is no /internal/settings page yet.
    // Re-add here when the gateway-backed settings surface lands.

    out.push({
      id: 'signout',
      kind: 'signout',
      label: 'Sign out',
      onSelect: () => {
        void handleSignOut();
      },
    });

    return Object.freeze(out);
  }, [router, handleSignOut]);

  return (
    <CommandPalette
      items={items}
      placeholder="Type a command or search admin..."
      labels={{
        navigate: 'Navigate',
        action: 'Actions',
        settings: 'Settings',
        signout: 'Sign out',
        empty: 'No matches',
      }}
    />
  );
}
