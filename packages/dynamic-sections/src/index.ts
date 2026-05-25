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
  type SectionContextLoader,
  type SectionContextProviderProps,
  type SectionProviderConfig,
  type UseSectionRegistryArgs,
  type UseSectionRegistryResult,
  type ViewportBreakpoint,
  type UseSwipeNavArgs,
  type UseSwipeNavResult,
  type SectionQueryScope,
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
