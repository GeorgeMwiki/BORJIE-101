/**
 * `@borjie/geology-advisor` — public surface.
 */

export {
  createGeologyAdvisor,
  compositeIntervals,
  triangulateVein,
  computeOreBodyStats,
  deriveRecommendations,
  type GeologyAdvisor,
  type GeologyAdvisorDeps,
} from './geology.js';

export {
  geologyInputSchema,
  geologyAnalysisSchema,
  geologyRecommendationSchema,
  geologyRecommendationContextSchema,
  compositedIntervalSchema,
  triangulatedMeshSchema,
  oreBodyStatsSchema,
  type GeologyInput,
  type GeologyAnalysis,
  type CompositedInterval,
  type TriangulatedMesh,
  type OreBodyStats,
  type GeologyRecommendation,
  type GeologyRecommendationContext,
  type GeologyRecommendationKind,
  type DrillHoleCollar,
  type AssayInterval,
  type VeinSamplePoint,
  type Point3D,
  type EvidenceRef,
} from './types.js';

export {
  NOOP_LOGGER,
  type Logger,
  type LmbmGeologyPort,
} from './ports.js';
