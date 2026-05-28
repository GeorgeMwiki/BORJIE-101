'use client';

/**
 * OwnerOSTabHost — wraps the currently visible panel in <TabSleeper>
 * with isActive=true while every other open tab gets a TabSleeper with
 * isActive=false (snapshot placeholder, children NOT mounted).
 *
 * Wave OWNER-OS-DYNAMIC Phase 2 — INTELLIGENT LAZY-LOAD + SLEEP.
 *
 * Why route through this host instead of conditionally rendering the
 * active panel only?
 *   1. Persistence — keeping every TabSleeper in the tree (even when
 *      asleep) means React preserves the snapshot state per tab id, so
 *      we can fade the snapshot in on wake without skeleton flash.
 *   2. Deep stability — stable component identity keeps the parent
 *      `<TabActiveContext.Provider>` per tab so descendant
 *      `useTabActiveEffect` cleanups fire deterministically.
 *   3. Backend awareness untouched — the brain prompt extension reminds
 *      the model that every spawned tab remains in its awareness. Sleep
 *      is purely a FE rendering optimisation.
 *
 * The shell wires its router (which tab kind maps to which component)
 * via the `renderPanel` callback so this host stays generic.
 */

import { useMemo, type ReactElement, type ReactNode } from 'react';

import type { OwnerTab } from '@/lib/owner-tabs-store';
import { TabSleeper } from './TabSleeper';

export interface OwnerOSTabHostProps {
  readonly tabs: ReadonlyArray<OwnerTab>;
  readonly activeTabId: string | null;
  readonly languagePreference: 'sw' | 'en';
  /**
   * Render callback the shell wires up. Receives the tab and must return
   * the corresponding panel component. The host does NOT inspect kind
   * itself — that mapping lives in the shell so this file stays free of
   * panel imports.
   */
  readonly renderPanel: (tab: OwnerTab) => ReactNode;
}

/**
 * Map a tab kind to a Borjie semantic accent. Drives the snapshot dot
 * + ring tone — gold for compliance / risk, navy by default.
 */
function accentFor(kind: OwnerTab['kind']): 'navy' | 'gold' | 'cream' {
  switch (kind) {
    case 'compliance':
    case 'risk':
    case 'audit':
    case 'legal':
      return 'gold';
    case 'chat':
    case 'insights':
      return 'cream';
    default:
      return 'navy';
  }
}

export function OwnerOSTabHost({
  tabs,
  activeTabId,
  languagePreference,
  renderPanel,
}: OwnerOSTabHostProps): ReactElement {
  // Render every tab inside its own TabSleeper. Only one has isActive
  // true at any moment — the rest emit snapshot placeholders.
  const slots = useMemo(
    () =>
      tabs.map((tab) => ({
        tab,
        isActive: tab.id === activeTabId,
        accent: accentFor(tab.kind),
      })),
    [tabs, activeTabId],
  );

  return (
    <section
      aria-label="Owner cockpit panels"
      data-testid="owner-os-tab-host"
      className="flex flex-col gap-4"
    >
      {slots.map(({ tab, isActive, accent }) =>
        isActive ? (
          <div
            key={tab.id}
            data-testid={`owner-os-panel-${tab.id}`}
            data-tab-state="active"
          >
            <TabSleeper
              tabId={tab.id}
              isActive={true}
              title={tab.title}
              languagePreference={languagePreference}
              accent={accent}
            >
              {renderPanel(tab)}
            </TabSleeper>
          </div>
        ) : (
          <div
            key={tab.id}
            data-testid={`owner-os-panel-${tab.id}-asleep`}
            data-tab-state="asleep"
            className="hidden"
          >
            {/* asleep tabs are hidden visually; their TabSleeper stays in
                the React tree so the snapshot key stays stable, but the
                wrapper className=hidden keeps them out of paint. The
                snapshot itself becomes visible only when the shell shows
                it in the strip preview / drawer — never inline. */}
            <TabSleeper
              tabId={tab.id}
              isActive={false}
              title={tab.title}
              languagePreference={languagePreference}
              accent={accent}
            >
              {/* never rendered when isActive=false */}
              {null}
            </TabSleeper>
          </div>
        ),
      )}
    </section>
  );
}
