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

const OWNER_NAV_ROUTES: ReadonlyArray<{
  readonly route: string;
  readonly labelEn: string;
  readonly labelSw: string;
}> = [
  { route: '/', labelEn: 'Home', labelSw: 'Nyumbani' },
  { route: '/dashboard', labelEn: 'Dashboard', labelSw: 'Dashibodi' },
  { route: '/licences', labelEn: 'Licences', labelSw: 'Leseni' },
  { route: '/compliance', labelEn: 'Compliance', labelSw: 'Kufuata sheria' },
  { route: '/finance', labelEn: 'Finance', labelSw: 'Fedha' },
  { route: '/counterparties', labelEn: 'Counterparties', labelSw: 'Wadau' },
  { route: '/cooperatives', labelEn: 'Cooperatives', labelSw: 'Vyama vya ushirika' },
  { route: '/insurance', labelEn: 'Insurance', labelSw: 'Bima' },
  { route: '/documents', labelEn: 'Documents', labelSw: 'Hati' },
  { route: '/estate', labelEn: 'Estate', labelSw: 'Mali' },
  { route: '/chain-of-custody', labelEn: 'Chain of custody', labelSw: 'Mlolongo wa uangalizi' },
  { route: '/inbox', labelEn: 'Inbox', labelSw: 'Sanduku la barua' },
];

const QUICK_ACTIONS: ReadonlyArray<{
  readonly id: string;
  readonly labelEn: string;
  readonly labelSw: string;
  readonly intent: string;
}> = [
  { id: 'royalty.draft', labelEn: 'Draft royalty filing', labelSw: 'Andaa malipo ya mrabaha', intent: 'royalty-draft' },
  { id: 'reminder.create', labelEn: 'Create a reminder', labelSw: 'Tengeneza kikumbusho', intent: 'create-reminder' },
  { id: 'doc.upload', labelEn: 'Upload a document', labelSw: 'Pakia hati', intent: 'upload-doc' },
  { id: 'cooperative.settle', labelEn: 'Cooperative settlement', labelSw: 'Tathmini ya ushirika', intent: 'coop-settlement' },
  { id: 'share.generate', labelEn: 'Generate share link', labelSw: 'Tengeneza kiungo cha kushirikisha', intent: 'share-link' },
  { id: 'pin.show', labelEn: 'Show my pinned items', labelSw: 'Onyesha vitu vyangu nilivyopanga', intent: 'pinned-items' },
];

export interface OwnerCommandPaletteProps {
  readonly languagePreference: 'sw' | 'en';
  /** Optional callback so the host can dispatch chat-driven actions. */
  readonly onActionIntent?: (intent: string) => void;
  /** Optional callback to spawn a tab from the registry. */
  readonly onSpawnTab?: (type: string) => void;
  /** Optional sign-out hook. */
  readonly onSignOut?: () => void;
}

export function OwnerCommandPalette({
  languagePreference,
  onActionIntent,
  onSpawnTab,
  onSignOut,
}: OwnerCommandPaletteProps): ReactElement {
  const router = useRouter();
  const sw = languagePreference === 'sw';

  const items = useMemo<ReadonlyArray<CommandItem>>(() => {
    const out: CommandItem[] = [];

    for (const nav of OWNER_NAV_ROUTES) {
      out.push({
        id: `nav_${nav.route}`,
        kind: 'navigate',
        label: sw ? nav.labelSw : nav.labelEn,
        hint: nav.route,
        keywords: [nav.route, nav.labelEn.toLowerCase(), nav.labelSw.toLowerCase()],
        onSelect: () => router.push(nav.route),
      });
    }

    for (const action of QUICK_ACTIONS) {
      out.push({
        id: `act_${action.id}`,
        kind: 'action',
        label: sw ? action.labelSw : action.labelEn,
        keywords: [action.id, action.intent],
        onSelect: () => {
          if (onActionIntent) onActionIntent(action.intent);
        },
      });
    }

    for (const tab of listTabs()) {
      out.push({
        id: `tab_${tab.type}`,
        kind: 'spawn_tab',
        label: sw ? tab.labelSw : tab.labelEn,
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
      label: sw ? 'Mipangilio' : 'Settings',
      onSelect: () => router.push('/settings'),
    });

    if (onSignOut) {
      out.push({
        id: 'signout',
        kind: 'signout',
        label: sw ? 'Toka' : 'Sign out',
        onSelect: () => onSignOut(),
      });
    }

    return Object.freeze(out);
  }, [router, sw, onActionIntent, onSpawnTab, onSignOut]);

  return (
    <CommandPalette
      items={items}
      placeholder={
        sw ? 'Andika amri au tafuta...' : 'Type a command or search...'
      }
      labels={{
        recent: sw ? 'Hivi karibuni' : 'Recent',
        navigate: sw ? 'Nenda' : 'Navigate',
        action: sw ? 'Vitendo' : 'Actions',
        spawn_tab: sw ? 'Fungua kichupo' : 'Spawn tab',
        settings: sw ? 'Mipangilio' : 'Settings',
        signout: sw ? 'Toka' : 'Sign out',
        empty: sw ? 'Hakuna matokeo' : 'No matches',
      }}
    />
  );
}
