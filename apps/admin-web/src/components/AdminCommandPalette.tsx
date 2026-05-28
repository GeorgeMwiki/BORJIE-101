'use client';

/**
 * AdminCommandPalette - mounts the universal Cmd-K palette for the
 * admin console with curated admin catalog: Navigate (every admin
 * route), Actions (top admin verbs), Settings, Sign out.
 *
 * Symmetrical sibling of `apps/owner-web/src/components/OwnerCommandPalette.tsx`.
 */

import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { CommandPalette, type CommandItem } from '@borjie/design-system';

const ADMIN_NAV_ROUTES: ReadonlyArray<{
  readonly route: string;
  readonly label: string;
}> = [
  { route: '/internal', label: 'Internal home' },
  { route: '/internal/tenants', label: 'Tenants' },
  { route: '/internal/intelligence-corpus', label: 'Intelligence corpus' },
  { route: '/internal/prompts', label: 'Prompt registry' },
  { route: '/internal/models', label: 'Model registry' },
  { route: '/internal/compliance', label: 'Compliance review' },
  { route: '/internal/audit-logs', label: 'Audit logs' },
  { route: '/internal/killswitch', label: 'Kill switch' },
  { route: '/internal/feature-flags', label: 'Feature flags' },
  { route: '/internal/incidents', label: 'Incidents' },
  { route: '/internal/ai-costs', label: 'AI costs' },
];

export function AdminCommandPalette(): ReactElement {
  const router = useRouter();

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

    out.push({
      id: 'settings_general',
      kind: 'settings',
      label: 'Settings',
      onSelect: () => router.push('/internal/settings'),
    });

    out.push({
      id: 'signout',
      kind: 'signout',
      label: 'Sign out',
      onSelect: () => router.push('/sign-out'),
    });

    return Object.freeze(out);
  }, [router]);

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
