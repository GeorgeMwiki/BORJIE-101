'use client';

/**
 * TabSleeper — frame-rate friendly wrapper for inactive tab panels.
 *
 * Wave OWNER-OS-DYNAMIC Phase 2 — INTELLIGENT LAZY-LOAD + SLEEP.
 *
 * Inactive tabs (not the currently visible one) MUST go to SLEEP to free
 * CPU / memory / network. This wrapper:
 *
 *   1. ACTIVE — renders children normally inside a
 *      `<TabActiveContext.Provider value={true}>` so descendant hooks
 *      (`useTabActiveEffect`) keep their subscriptions live.
 *   2. ASLEEP — renders a lightweight snapshot placeholder pulled from
 *      `readTabSnapshot(tabId)`. Children are unmounted, which fires every
 *      `useEffect` / `useTabActiveEffect` cleanup, drops websockets,
 *      cancels timers, and frees React fiber memory. The descendant
 *      `<TabActiveContext.Provider value={false}>` only applies to the
 *      empty children render so any `useTabActiveEffect` in a
 *      sibling/parent sees the sleep flag.
 *
 * Backend awareness is intentionally untouched — sleep is FE-only. The
 * brain still holds the tab's context in its `owner_tabs` row and the
 * teaching prompt extension reminds it that every spawned tab remains in
 * its awareness regardless of FE visibility.
 *
 * Wake-up rendering uses `unstable_startTransition` so wake never blocks
 * the click handler — the snapshot stays on screen until the live panel
 * is ready, then swaps without a skeleton flash.
 */

import {
  Suspense,
  startTransition,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import { TabActiveContext } from './useTabActiveEffect';
import {
  readTabSnapshot,
  type TabSnapshotData,
} from './useTabSnapshot';
import { TabSnapshotShell } from './TabSnapshotShell';

export interface TabSleeperProps {
  /** Stable tab id — used to scope the snapshot key. */
  readonly tabId: string;
  /** True when this tab is the active one. */
  readonly isActive: boolean;
  /** Owner-facing title — shown in the snapshot placeholder. */
  readonly title: string;
  /** Language for the placeholder caption. */
  readonly languagePreference: 'sw' | 'en';
  /** Optional accent color for the placeholder. Defaults to navy / gold. */
  readonly accent?: 'navy' | 'gold' | 'cream';
  /** The panel itself. Only mounted when `isActive`. */
  readonly children: ReactNode;
}

/**
 * The wrapper. Stable component identity across active/inactive
 * transitions so siblings stay mounted.
 */
export function TabSleeper({
  tabId,
  isActive,
  title,
  languagePreference,
  accent,
  children,
}: TabSleeperProps): ReactElement {
  // Track snapshot once per (tabId, sleep-cycle). Re-read on each sleep
  // transition so the next wake picks up the freshest snapshot.
  const [snapshot, setSnapshot] = useState<TabSnapshotData | null>(() =>
    readTabSnapshot(tabId),
  );

  useEffect(() => {
    if (!isActive) {
      // Refresh snapshot on transition to sleep so next wake is fresh.
      setSnapshot(readTabSnapshot(tabId));
    }
  }, [isActive, tabId]);

  // Wake transition — when the tab becomes active, mount the panel
  // inside startTransition so the click handler returns immediately and
  // React paints the snapshot first.
  const [hydrated, setHydrated] = useState(isActive);
  useEffect(() => {
    if (isActive && !hydrated) {
      startTransition(() => setHydrated(true));
    }
    // Re-sleep is intentionally NOT instant — keep hydrated true while
    // mounting reset happens via the parent unmounting this entire
    // subtree (see OwnerOSTabHost — only one TabSleeper has its panel
    // mounted at a time, the rest render a snapshot placeholder).
  }, [isActive, hydrated]);

  const contextValue = useMemo(() => isActive, [isActive]);

  if (!isActive) {
    return (
      <TabActiveContext.Provider value={false}>
        <TabSnapshotShell
          title={title}
          languagePreference={languagePreference}
          snapshot={snapshot}
          accent={accent ?? 'navy'}
        />
      </TabActiveContext.Provider>
    );
  }

  return (
    <TabActiveContext.Provider value={contextValue}>
      <Suspense
        fallback={
          <TabSnapshotShell
            title={title}
            languagePreference={languagePreference}
            snapshot={snapshot}
            accent={accent ?? 'navy'}
            mode="waking"
          />
        }
      >
        {hydrated ? children : (
          <TabSnapshotShell
            title={title}
            languagePreference={languagePreference}
            snapshot={snapshot}
            accent={accent ?? 'navy'}
            mode="waking"
          />
        )}
      </Suspense>
    </TabActiveContext.Provider>
  );
}
