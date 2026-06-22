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
import { useLocale, pickByLocale } from '@/lib/locale';

// Every route below resolves to a real page in `app/`. The earlier
// catalog shipped eight slugs that 404'd (intelligence-corpus,
// compliance, audit-logs, feature-flags, an /internal/ai-costs that
// lives at the top level, plus incidents/settings pages that were never
// built). Corrected to the live slugs; entries with no real page were
// dropped, and Sign out now calls the real auth flow instead of routing
// to a dead /sign-out URL.
// Each route carries an EN + SW label (single-language-per-locale canon).
// The English label is ALSO kept as a fuzzy-search keyword so an EN operator
// typing "tenants" still matches while the SW operator sees "Wateja".
const ADMIN_NAV_ROUTES: ReadonlyArray<{
  readonly route: string;
  readonly label: string;
  readonly labelSw: string;
}> = [
  { route: '/internal', label: 'Internal home', labelSw: 'Nyumbani ya ndani' },
  { route: '/internal/tenants', label: 'Tenants', labelSw: 'Wateja' },
  { route: '/internal/corpus', label: 'Intelligence corpus', labelSw: 'Hifadhi ya akili' },
  { route: '/internal/prompts', label: 'Prompt registry', labelSw: 'Msajili wa miongozo' },
  { route: '/internal/models', label: 'Model registry', labelSw: 'Msajili wa mifano' },
  { route: '/internal/compliance-queue', label: 'Compliance review', labelSw: 'Ukaguzi wa uzingatiaji' },
  { route: '/internal/audit-log', label: 'Audit logs', labelSw: 'Kumbukumbu za ukaguzi' },
  { route: '/internal/killswitch', label: 'Kill switch', labelSw: 'Swichi ya kuzima' },
  { route: '/internal/flags', label: 'Feature flags', labelSw: 'Bendera za vipengele' },
  { route: '/ai-costs', label: 'AI costs', labelSw: 'Gharama za AI' },
  // Fully gateway-backed (GET /admin/subscriptions) but previously had no nav
  // door anywhere — reachable only by typing the URL. Surfaced here.
  { route: '/platform/subscriptions', label: 'Subscriptions', labelSw: 'Michango' },
];

export function AdminCommandPalette(): ReactElement {
  const router = useRouter();
  // The palette is a purely-client overlay mounted in the layout (no SSR
  // markup until the operator opens it with Cmd-K), so a bare `useLocale()`
  // is safe here — there is no first-paint surface to split-brain. It still
  // re-renders the labels in the operator's active language.
  const locale = useLocale();

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
        label: pickByLocale(locale, { en: nav.label, sw: nav.labelSw }),
        hint: nav.route,
        // Keep BOTH locale labels in the keyword set so fuzzy search hits
        // regardless of which language the operator types.
        keywords: [
          nav.route,
          nav.label.toLowerCase(),
          nav.labelSw.toLowerCase(),
        ],
        onSelect: () => router.push(nav.route),
      });
    }

    // Wave SUPERPOWERS — bulk-action shortcut. Cmd+Shift+B opens the
    // drawer directly; exposing the verb in the palette lets it land in
    // fuzzy search + the `recent` bucket once used.
    out.push({
      id: 'action_bulk_action',
      kind: 'action',
      label: pickByLocale(locale, {
        en: 'Bulk action (Cmd+Shift+B)',
        sw: 'Kitendo cha wingi (Cmd+Shift+B)',
      }),
      hint: pickByLocale(locale, {
        en: 'suspend / reactivate / export-regulator-pack / reindex…',
        sw: 'simamisha / amilisha tena / hamisha-kifurushi-cha-mdhibiti / panga upya…',
      }),
      keywords: [
        'bulk',
        'wingi',
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
      label: pickByLocale(locale, { en: 'Sign out', sw: 'Toka' }),
      onSelect: () => {
        void handleSignOut();
      },
    });

    return Object.freeze(out);
  }, [router, handleSignOut, locale]);

  return (
    <CommandPalette
      items={items}
      placeholder={pickByLocale(locale, {
        en: 'Type a command or search admin...',
        sw: 'Andika amri au tafuta msimamizi...',
      })}
      labels={{
        navigate: pickByLocale(locale, { en: 'Navigate', sw: 'Nenda' }),
        action: pickByLocale(locale, { en: 'Actions', sw: 'Vitendo' }),
        settings: pickByLocale(locale, { en: 'Settings', sw: 'Mipangilio' }),
        signout: pickByLocale(locale, { en: 'Sign out', sw: 'Toka' }),
        empty: pickByLocale(locale, { en: 'No matches', sw: 'Hakuna matokeo' }),
      }}
    />
  );
}
