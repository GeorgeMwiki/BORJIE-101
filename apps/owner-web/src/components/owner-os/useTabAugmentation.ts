'use client';

/**
 * useTabAugmentation — panel-level hook that re-renders WITHOUT remount
 * when the brain or owner augments the current tab's context.
 *
 * Wave OWNER-OS-DYNAMIC Phase 2.
 *
 * The store's `spawnOrAugment` re-uses an existing tab id and merges new
 * context fields into it. Panels render with `key={tabId}` so React
 * preserves their internal state across context merges. This hook lets
 * the panel:
 *
 *   1. Read the current merged context.
 *   2. Receive a `change` flag (true for ~1.2s after each augmentation)
 *      so it can softly highlight the new rows / fields.
 *   3. Read the `pendingUpdates` count so it can render "+N updates" if
 *      it wants its own affordance (the tab pip already shows one).
 *
 * The hook is read-only — it does NOT mutate the store. To clear the
 * pending badge after the owner sees the new content, call
 * `acknowledgeAugmentation(tabId)` from the tabs API (the shell does this
 * automatically when the tab gains focus, so most panels never need to).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useOwnerTabs, type OwnerTab } from '@/lib/owner-tabs-store';

/** Soft-highlight window after each augmentation. ~1.2s per spec. */
const HIGHLIGHT_MS = 1_200;

export interface TabAugmentationState {
  /** The current (post-merge) context object, or undefined when none. */
  readonly context: Readonly<Record<string, unknown>> | undefined;
  /**
   * True for ~1.2s after each augmentation event. Panels read this to
   * fade-in highlight new rows / fields.
   */
  readonly justChanged: boolean;
  /**
   * Monotonic counter — increments by one each time `augmentedAt` changes.
   * Useful as a key for re-running animations or refetches.
   */
  readonly augmentationCount: number;
  /** Unacknowledged "+N updates" — mirrors the pip badge in the strip. */
  readonly pendingUpdates: number;
  /**
   * Convenience extractor — panels often need a flat list of "focus"
   * values to render subtab chips. Pulls `context.focus` and normalises
   * to an array of strings (returns [] when missing).
   */
  readonly focusValues: ReadonlyArray<string>;
  /**
   * Optional additionalFields the panel renderer should conditionally
   * show. Brain spec: panel renderers accept optional
   * `additionalFields: string[]` via context. Pulled from
   * `context.additionalFields` and coerced to a string array.
   */
  readonly additionalFields: ReadonlyArray<string>;
}

function findTab(
  tabs: ReadonlyArray<OwnerTab>,
  tabId: string,
): OwnerTab | null {
  return tabs.find((t) => t.id === tabId) ?? null;
}

function normaliseStringArray(value: unknown): ReadonlyArray<string> {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  if (typeof value === 'string') return [value];
  return [];
}

/**
 * Watch a single tab's context. Returns a snapshot of merged context plus
 * change-detection flags so the panel can softly highlight what changed.
 */
export function useTabAugmentation(tabId: string): TabAugmentationState {
  const { tabs } = useOwnerTabs();
  const tab = useMemo(() => findTab(tabs, tabId), [tabs, tabId]);

  const lastAugmentedAt = useRef<string | undefined>(tab?.augmentedAt);
  const [augmentationCount, setAugmentationCount] = useState(0);
  const [justChanged, setJustChanged] = useState(false);

  useEffect(() => {
    const current = tab?.augmentedAt;
    if (current && current !== lastAugmentedAt.current) {
      lastAugmentedAt.current = current;
      setAugmentationCount((n) => n + 1);
      setJustChanged(true);
      const timer = setTimeout(() => setJustChanged(false), HIGHLIGHT_MS);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [tab?.augmentedAt]);

  return useMemo(() => {
    const context = tab?.context;
    return {
      context,
      justChanged,
      augmentationCount,
      pendingUpdates: tab?.pendingUpdates ?? 0,
      focusValues: normaliseStringArray(context?.['focus']),
      additionalFields: normaliseStringArray(context?.['additionalFields']),
    };
  }, [tab, justChanged, augmentationCount]);
}
