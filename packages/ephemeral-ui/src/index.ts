/**
 * `@borjie/ephemeral-ui` — public surface.
 *
 * Function-attached dashboards. Every domain function declares a
 * `FunctionUIManifest`; `composeDashboardForFunction` emits an
 * `EphemeralDashboard` + a payload that the dynamic-ui rail renders
 * briefly and discards. High-reuse patterns are promoted to learned
 * recipes via `decidePromotion`.
 *
 * Source of truth:
 *   - `Docs/STRATEGY/EPHEMERAL_SOFTWARE_SOTA.md`
 *   - `Docs/DESIGN/FUNCTION_ATTACHED_DASHBOARD_SPEC.md`
 *
 * Eleven public exports:
 *   1. FunctionUIManifest (type)
 *   2. DashboardArchetype + DASHBOARD_ARCHETYPES
 *   3. UIHints (type)
 *   4. UserContext (type)
 *   5. composeDashboardForFunction
 *   6. registerFunctionUIManifest + getLatestManifest
 *   7. validateFunctionUIManifest
 *   8. createComposeCache + computeExpiresAt
 *   9. createReuseCounter
 *  10. decidePromotion + PROMOTION_REUSE_THRESHOLD
 *  11. createInMemoryTelemetryRepository + buildComposeAuditPayload
 */

// ── Types ────────────────────────────────────────────────────────────
export type {
  ActionDescriptor,
  AuthorityTier,
  BrandDnaSnapshot,
  BrandLockResult,
  ComposeCacheEntry,
  ComposeCacheKey,
  ComposeFailure,
  ComposeResult,
  ContextRequirement,
  ContextRequirementKind,
  DashboardArchetype,
  Emphasis,
  EphemeralDashboard,
  EphemeralDashboardTelemetryRow,
  FunctionUIManifest,
  Locale,
  MasteryLevel,
  MemoryRecallHit,
  MobileStrategy,
  PreferredLayout,
  PreferredSize,
  UIHints,
  UserContext,
} from './types.js';
export { DASHBOARD_ARCHETYPES } from './types.js';

// ── Manifests ────────────────────────────────────────────────────────
export {
  registerFunctionUIManifest,
  getManifest,
  getLatestManifest,
  listRegisteredManifests,
  __resetRegistryForTests,
} from './manifests/manifest-registry.js';
export {
  validateFunctionUIManifest,
  assertValidManifest,
  type ManifestValidationResult,
} from './manifests/manifest-validator.js';

// ── Composer ─────────────────────────────────────────────────────────
export {
  composeDashboardForFunction,
  hashUserContext,
  hashRecipeShape,
  type ComposeResultWithPayload,
} from './composer/compose-dashboard.js';
export {
  brandLockPass,
  checkPreferredColors,
} from './composer/brand-lock-pass.js';
export {
  renderArchetype,
  type ArchetypePayload,
  type ArchetypeSection,
} from './composer/archetype-renderer.js';

// ── Lifecycle ────────────────────────────────────────────────────────
export {
  createComposeCache,
  computeExpiresAt,
  isExpired,
  type ComposeCache,
} from './lifecycle/cache-policy.js';
export {
  createReuseCounter,
  type ReuseCounter,
  type ReuseSnapshot,
} from './lifecycle/reuse-counter.js';
export {
  decidePromotion,
  PROMOTION_REUSE_THRESHOLD,
  PROMOTION_DISTINCT_USER_THRESHOLD,
  type PromotionDecision,
} from './lifecycle/promotion-decider.js';

// ── Storage ──────────────────────────────────────────────────────────
export {
  createInMemoryTelemetryRepository,
  type TelemetryRepository,
  type TelemetryInsertInput,
} from './storage/telemetry-repository.js';

// ── Audit ────────────────────────────────────────────────────────────
export {
  buildComposeAuditPayload,
  type ComposeAuditPayload,
} from './audit/audit-chain-link.js';
