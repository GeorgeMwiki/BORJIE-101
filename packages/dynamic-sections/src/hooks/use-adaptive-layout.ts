/**
 * `useAdaptiveLayout()` — DU-1 audit fix.
 *
 * Thin React hook that wraps the pure `decideLayout` engine for app
 * consumption. Apps had two ways to consume the engine before this
 * hook landed:
 *
 *   1. Reach into the lib subpath (`@borjie/dynamic-sections/lib/...`)
 *      — not a public surface and triggers tree-shaking warnings.
 *   2. Call `decideLayout` directly inside a component — works but the
 *      caller has to hand-build `LayoutContext` on every render.
 *
 * This hook closes the gap by:
 *   - Building `LayoutContext` from explicit args + sensible defaults.
 *   - Running the engine inside `useMemo` so renders skip the policy
 *     evaluation when no input changes.
 *   - Returning the full `LayoutDecision` so callers can render the
 *     pinned-set, hidden-set, and rationale (debug overlay) without
 *     re-running policies.
 *
 * The hook is INTENTIONALLY decoupled from the SectionRegistry — apps
 * that don't use `useSectionRegistry()` (e.g. the workforce-mobile tab
 * strip, which has a hand-rolled FIXED-tab policy per
 * `0091_workforce_role_tab_configs.sql`) can still adopt the engine.
 *
 * SOTA refs: Linear "what changed since you last looked", Raycast
 * frecency, Apple Spotlight on-device ranker. See
 * `Docs/RESEARCH/DYNAMIC_UI_SOTA_2026-05-29.md`.
 */

import { useMemo } from 'react';
import { decideLayout } from '../lib/adaptive-layout/engine.js';
import { defaultPolicies } from '../lib/adaptive-layout/index.js';
import type {
  LayoutContext,
  LayoutDecision,
  LayoutPolicy,
  SectionId,
} from '../lib/adaptive-layout/types.js';

export interface UseAdaptiveLayoutArgs {
  /** Section ids in their default (registry) order. */
  readonly baseSections: readonly SectionId[];
  /** Render context — tenant, user, route, role, behaviour, intent. */
  readonly context: LayoutContext;
  /**
   * Optional custom policy bundle. Defaults to the shipped
   * `defaultPolicies` (intent, frustration, role-mastery, recency).
   *
   * The platform-admin portal should pass a bundle EXCLUDING
   * frustration-policy because the operator is not the user being
   * observed. See `packages/dynamic-sections/src/lib/adaptive-layout/index.ts`.
   */
  readonly policies?: readonly LayoutPolicy[];
}

/**
 * Run the adaptive-layout engine in a render-stable, memoised hook.
 *
 * Determinism: the same args produce the same `LayoutDecision` across
 * renders (the engine is pure; this hook is just a thin React wrapper).
 *
 * Performance: policy evaluation is O(N policies × M sections). With
 * the default 4 policies and a typical 5-20 section strip the cost is
 * under 50 microseconds — negligible vs. a render. `useMemo` skips
 * re-running when nothing changed.
 */
export function useAdaptiveLayout(
  args: UseAdaptiveLayoutArgs,
): LayoutDecision {
  const { baseSections, context, policies = defaultPolicies } = args;

  return useMemo(
    () => decideLayout(context, baseSections, policies),
    [context, baseSections, policies],
  );
}
