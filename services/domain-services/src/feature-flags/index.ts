/**
 * Feature Flags module — Wave 9 enterprise polish.
 */
export {
  createFeatureFlagsService,
  DrizzleFeatureFlagsRepository,
  FeatureFlagError,
  type FeatureFlagsService,
  type FeatureFlagsServiceDeps,
  type FeatureFlagsRepository,
  type FeatureFlag,
  type TenantFeatureFlagOverride,
  type ResolvedFeatureFlag,
  type DrizzleLike,
} from './feature-flags-service.js';
