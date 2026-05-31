'use client';

/**
 * OwnerCommandPalette - mounts the universal Cmd-K palette for the
 * owner-web with the curated owner catalog: Navigate (every owner-os
 * route), Actions (top 12 chat-callable verbs), Spawn tab (every
 * registered owner-os tab descriptor), Settings.
 *
 * The catalog is computed once per mount; the items are pure values
 * that close over `router` so click handlers are stable.
 */

import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { CommandPalette, type CommandItem } from '@borjie/design-system';
import { listTabs } from '@borjie/owner-os-tabs';
import { useLocale } from '@/lib/locale';
import { useT } from '@/i18n/t.client';

const OWNER_NAV_ROUTES: ReadonlyArray<{
  readonly route: string;
  readonly labelKey: string;
}> = [
  { route: '/', labelKey: 'nav.home' },
  { route: '/dashboard', labelKey: 'nav.dashboard' },
  { route: '/licences', labelKey: 'nav.licences' },
  { route: '/compliance', labelKey: 'nav.compliance' },
  { route: '/finance', labelKey: 'nav.finance' },
  { route: '/counterparties', labelKey: 'nav.counterparties' },
  { route: '/cooperatives', labelKey: 'nav.cooperatives' },
  { route: '/insurance', labelKey: 'nav.insurance' },
  { route: '/documents', labelKey: 'nav.documents' },
  { route: '/estate', labelKey: 'nav.estate' },
  { route: '/chain-of-custody', labelKey: 'nav.chainOfCustody' },
  { route: '/inbox', labelKey: 'nav.inbox' },
];

const QUICK_ACTIONS: ReadonlyArray<{
  readonly id: string;
  readonly labelKey: string;
  readonly intent: string;
}> = [
  { id: 'royalty.draft', labelKey: 'palette.actionRoyaltyDraft', intent: 'royalty-draft' },
  { id: 'reminder.create', labelKey: 'palette.actionCreateReminder', intent: 'create-reminder' },
  { id: 'doc.upload', labelKey: 'palette.actionUploadDoc', intent: 'upload-doc' },
  { id: 'cooperative.settle', labelKey: 'palette.actionCoopSettle', intent: 'coop-settlement' },
  { id: 'share.generate', labelKey: 'palette.actionShareLink', intent: 'share-link' },
  { id: 'pin.show', labelKey: 'palette.actionPinnedItems', intent: 'pinned-items' },
];

export interface OwnerCommandPaletteProps {
  /**
   * Retained for caller compatibility; the active locale now flows from
   * the borjie_locale cookie via useT()/useLocale (the single source).
   */
  readonly languagePreference?: 'sw' | 'en';
  /** Optional callback so the host can dispatch chat-driven actions. */
  readonly onActionIntent?: (intent: string) => void;
  /** Optional callback to spawn a tab from the registry. */
  readonly onSpawnTab?: (type: string) => void;
  /** Optional sign-out hook. */
  readonly onSignOut?: () => void;
}

export function OwnerCommandPalette({
  onActionIntent,
  onSpawnTab,
  onSignOut,
}: OwnerCommandPaletteProps): ReactElement {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();

  const items = useMemo<ReadonlyArray<CommandItem>>(() => {
    const out: CommandItem[] = [];

    for (const nav of OWNER_NAV_ROUTES) {
      const label = t(nav.labelKey);
      out.push({
        id: `nav_${nav.route}`,
        kind: 'navigate',
        label,
        hint: nav.route,
        keywords: [nav.route, label.toLowerCase()],
        onSelect: () => router.push(nav.route),
      });
    }

    for (const action of QUICK_ACTIONS) {
      out.push({
        id: `act_${action.id}`,
        kind: 'action',
        label: t(action.labelKey),
        keywords: [action.id, action.intent],
        onSelect: () => {
          if (onActionIntent) onActionIntent(action.intent);
        },
      });
    }

    for (const tab of listTabs()) {
      // Tab labels are owner-os-tabs package data (its own sw/en pair).
      const label = locale === 'sw' ? tab.labelSw : tab.labelEn;
      out.push({
        id: `tab_${tab.type}`,
        kind: 'spawn_tab',
        label,
        hint: tab.type,
        keywords: [tab.type, tab.labelEn.toLowerCase()],
        onSelect: () => {
          if (onSpawnTab) onSpawnTab(tab.type);
        },
      });
    }

    out.push({
      id: 'settings_general',
      kind: 'settings',
      label: t('nav.settings'),
      onSelect: () => router.push('/settings'),
    });

    if (onSignOut) {
      out.push({
        id: 'signout',
        kind: 'signout',
        label: t('nav.signOut'),
        onSelect: () => onSignOut(),
      });
    }

    return Object.freeze(out);
  }, [router, t, locale, onActionIntent, onSpawnTab, onSignOut]);

  return (
    <CommandPalette
      items={items}
      placeholder={t('palette.placeholder')}
      labels={{
        recent: t('palette.recent'),
        navigate: t('palette.navigate'),
        action: t('palette.action'),
        spawn_tab: t('palette.spawnTab'),
        settings: t('nav.settings'),
        signout: t('nav.signOut'),
        empty: t('palette.empty'),
      }}
    />
  );
}
