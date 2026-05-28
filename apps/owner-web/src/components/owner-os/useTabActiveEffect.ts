'use client';

/**
 * useTabActiveEffect — drop-in `useEffect` replacement that only fires
 * when the owning tab is currently active.
 *
 * Wave OWNER-OS-DYNAMIC Phase 2 — INTELLIGENT LAZY-LOAD + SLEEP.
 *
 * Inactive tabs go to sleep (rendered by `<TabSleeper>` as a snapshot
 * placeholder). Heavy effects — websocket subscriptions, polling timers,
 * SSE streams, recharts animations — must release their resources when
 * the tab sleeps and re-acquire them on wake. This hook gives panels a
 * one-line replacement for `useEffect` that does exactly that.
 *
 * Contract:
 *   - Effect runs when `isActive` (from `TabActiveProvider`) flips true.
 *   - Cleanup function runs when `isActive` flips false (or on unmount).
 *   - Deps array works exactly like React's `useEffect` — the effect is
 *     re-armed when deps change AND the tab is active.
 *
 * When there is no provider in the tree (i.e. the shell is rendering the
 * panel standalone outside the host), this hook degrades to a plain
 * `useEffect` so the panel still works in tests / Storybook.
 */

import {
  createContext,
  useContext,
  useEffect,
  type DependencyList,
  type EffectCallback,
} from 'react';

/**
 * Provided by `<TabSleeper>` / `<OwnerOSTabHost>` so every descendant
 * effect can ask "am I the currently visible tab?".
 */
export const TabActiveContext = createContext<boolean>(true);

export function useIsTabActive(): boolean {
  return useContext(TabActiveContext);
}

/**
 * Effect that only fires when the owning tab is active. When the tab
 * sleeps, the cleanup runs and the effect is not re-invoked until the
 * tab wakes.
 */
export function useTabActiveEffect(
  effect: EffectCallback,
  deps?: DependencyList,
): void {
  const isActive = useIsTabActive();
  useEffect(
    () => {
      if (!isActive) return undefined;
      return effect();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isActive, ...(deps ?? [])],
  );
}
