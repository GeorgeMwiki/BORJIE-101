'use client';

/**
 * useAdaptiveTabOrder — DU-5 audit fix.
 *
 * The OwnerOS tab strip stores tabs in INSERTION ORDER (pinned first,
 * then spawn order). That's fine for stability but it doesn't surface
 * "the tabs you actually use most" the way Linear's project insights
 * or Raycast's frecency ranking does.
 *
 * This hook is a NON-MUTATING display-layer helper: it runs the
 * `decideLayout` adaptive-layout engine over the live tab strip and
 * returns a recency/intent/role-mastery-ranked NEW array suitable for
 * the visible tab bar. The underlying store is untouched — so the
 * "+N updates" badge, augmentation contracts, and persistence stay
 * exactly the way `owner-tabs-store.ts` shipped them.
 *
 * Wiring contract:
 *
 *   const { tabs, activeTabId } = useOwnerTabs();
 *   const ordered = useAdaptiveTabOrder({
 *     tabs,
 *     recentActions,   // most-recent-first tab IDs from telemetry
 *     intent,          // current detected intent ('payment' | 'support' | …)
 *     masteryLevel,    // 'novice' | 'intermediate' | 'expert'
 *     viewport,        // 'mobile' | 'tablet' | 'desktop'
 *     tenantId, userId, role,
 *   });
 *   return <TabStrip tabs={ordered} active={activeTabId} />;
 *
 * Why this lives in apps/owner-web/components/owner-os (not in
 * packages/dynamic-sections): the OwnerTab shape is app-private; the
 * pure engine is in the shared package. This hook is the bridge.
 *
 * SOTA refs: Linear "what changed since you last looked", Raycast
 * frecency, Apple Spotlight on-device ranker. See
 * Docs/RESEARCH/DYNAMIC_UI_SOTA_2026-05-29.md.
 */

import { useMemo } from 'react';
import {
  useAdaptiveLayout,
  type LayoutContext,
  type AdaptiveMasteryLevel,
  type AdaptiveViewportBreakpoint,
  type AdaptiveDetectedIntent,
  type AdaptiveAffectiveProfile,
} from '@borjie/dynamic-sections';
import type { OwnerTab } from '@/lib/owner-tabs-store';

export interface UseAdaptiveTabOrderArgs {
  readonly tabs: ReadonlyArray<OwnerTab>;
  readonly tenantId: string;
  readonly userId: string;
  readonly role: string;
  /** Tab IDs ordered most-recent-first (capped to 10 by the engine). */
  readonly recentActions: ReadonlyArray<string>;
  readonly intent?: AdaptiveDetectedIntent;
  readonly masteryLevel?: AdaptiveMasteryLevel;
  readonly viewport?: AdaptiveViewportBreakpoint;
  readonly affectiveProfile?: AdaptiveAffectiveProfile;
  /**
   * Override the route key. Defaults to `owner.dashboard`. Adaptive-
   * layout uses this as the persistence key — two routes have
   * independent layouts.
   */
  readonly route?: string;
}

export interface UseAdaptiveTabOrderResult {
  /** The reordered tab list. Pinned tabs always stay first. */
  readonly tabs: ReadonlyArray<OwnerTab>;
  /** The engine's debug rationale. Surface in dev overlay if useful. */
  readonly rationale: string;
}

/**
 * Reorder tabs by the adaptive-layout engine WITHOUT mutating the
 * underlying owner-tabs store. Pinned tabs always come first, in their
 * original order — the engine only re-ranks NON-pinned tabs.
 */
export function useAdaptiveTabOrder(
  args: UseAdaptiveTabOrderArgs,
): UseAdaptiveTabOrderResult {
  const {
    tabs,
    tenantId,
    userId,
    role,
    recentActions,
    intent = null,
    masteryLevel = 'intermediate',
    viewport = 'desktop',
    affectiveProfile,
    route = 'owner.dashboard',
  } = args;

  // Split pinned vs free tabs so pinned never get reordered.
  const { pinned, free, freeIds } = useMemo(() => {
    const pinnedList: OwnerTab[] = [];
    const freeList: OwnerTab[] = [];
    for (const t of tabs) {
      if (t.pinned) pinnedList.push(t);
      else freeList.push(t);
    }
    return {
      pinned: pinnedList,
      free: freeList,
      freeIds: freeList.map((t) => t.id),
    };
  }, [tabs]);

  // Build the LayoutContext. The recency policy reads
  // `behavior.recentActions`; the intent policy reads `intent`. Both
  // tolerate empty inputs by abstaining.
  const context = useMemo<LayoutContext>(
    () => ({
      tenantId,
      userId,
      route,
      role,
      masteryLevel,
      behavior: { recentActions },
      intent,
      viewport,
      ...(affectiveProfile ? { affectiveProfile } : {}),
    }),
    [
      tenantId,
      userId,
      route,
      role,
      masteryLevel,
      recentActions,
      intent,
      viewport,
      affectiveProfile,
    ],
  );

  const decision = useAdaptiveLayout({
    baseSections: freeIds,
    context,
  });

  // Map ordered ids back to tabs; drop hidden ids; pinned go first.
  const reorderedFree = useMemo(() => {
    const byId = new Map(free.map((t) => [t.id, t]));
    const out: OwnerTab[] = [];
    for (const id of decision.sections) {
      const t = byId.get(id);
      if (t) out.push(t);
    }
    return out;
  }, [free, decision]);

  return useMemo(
    () => ({
      tabs: [...pinned, ...reorderedFree],
      rationale: decision.rationale,
    }),
    [pinned, reorderedFree, decision.rationale],
  );
}
