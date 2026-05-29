/**
 * @borjie/dynamic-sections — Phase J3.
 *
 * Mobile-first dynamic-tabs / lazy-load framework for the
 * owner-portal and admin-web. Tabs appear only when
 * the underlying entity type exists in the tenant. New entity
 * types materialise the moment the MD creates them via chat.
 *
 * Public surface:
 *   - {@link DynamicTabBar} — the headline component
 *   - {@link SectionMount} — deferred-data-mount wrapper
 *   - {@link SectionSkeleton} — Suspense fallback skeleton
 *   - {@link useSectionRegistry} — primary hook
 *   - {@link SectionContextProvider} — registry + loader provider
 *   - {@link SectionRegistry} — immutable registry store
 *   - {@link filterSections} / {@link evaluatePredicate} — pure logic
 *   - {@link createSeedRegistry} — J1 seed sections factory
 *
 * Vision: Portals NEVER pre-render tabs for entity types that
 * don't exist yet. Tabs appear only when data is present. New
 * entity types get a tab the moment the MD creates them via chat.
 * Mobile-first lazy-loading — Next.js dynamic imports + deferred
 * data-mount.
 */

// Contracts (types only)
export type {
  Section,
  SectionScope,
  SectionContext,
  SectionBadge,
  SectionComponentProps,
  ComponentModule,
  VisibilityPredicate,
  HasEntitiesPredicate,
  RoleAllowedPredicate,
  FeatureFlagPredicate,
  AndPredicate,
  OrPredicate,
} from './contracts/index.js';

// Registry primitives
export {
  SectionRegistry,
  evaluatePredicate,
  filterSections,
} from './registry/index.js';

// Hooks + provider
export {
  SectionContextProvider,
  useSectionRegistry,
  useViewportBreakpoint,
  useSwipeNav,
  sectionQueryKeys,
  useAdaptiveLayout,
  type SectionContextLoader,
  type SectionContextProviderProps,
  type SectionProviderConfig,
  type UseSectionRegistryArgs,
  type UseSectionRegistryResult,
  type ViewportBreakpoint,
  type UseSwipeNavArgs,
  type UseSwipeNavResult,
  type SectionQueryScope,
  type UseAdaptiveLayoutArgs,
} from './hooks/index.js';

// Components
export {
  DynamicTabBar,
  SectionMount,
  SectionSkeleton,
  type DynamicTabBarProps,
  type SectionMountProps,
  type SectionSkeletonProps,
} from './components/index.js';

// Seed registry (re-exported for convenience; consumers can also
// import from `@borjie/dynamic-sections/seed`).
export {
  seedSections,
  seedSectionKeys,
  createSeedRegistry,
} from './seed/index.js';

// Adaptive-layout engine (Wave DU-1) — pure-function decideLayout +
// four shipped policies. Exposing from the barrel so apps can run the
// engine over their tab strip without reaching into the lib subpath.
//
// SOTA refs: Linear "what changed since you last looked" (recency),
// Raycast useFrecencySorting (recency+frequency), Apple Spotlight
// Intelligence (on-device ranker), Notion AI intent-pinning.
export {
  decideLayout,
  defaultPolicies,
  frustrationPolicy,
  roleMasteryPolicy,
  recencyPolicy,
  intentPolicy,
  ABSTAIN,
  type SectionId as AdaptiveSectionId,
  type MasteryLevel as AdaptiveMasteryLevel,
  type ViewportBreakpoint as AdaptiveViewportBreakpoint,
  type AffectiveProfile as AdaptiveAffectiveProfile,
  type UserBehaviorPattern as AdaptiveUserBehaviorPattern,
  type DetectedIntent as AdaptiveDetectedIntent,
  type LayoutContext,
  type LayoutDecision,
  type LayoutPolicy,
  type LayoutPreference,
} from './lib/adaptive-layout/index.js';
