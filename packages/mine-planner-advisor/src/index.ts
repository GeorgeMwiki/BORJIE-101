/**
 * `@borjie/mine-planner-advisor` — public surface.
 */

export {
  createMinePlannerAdvisor,
  buildShiftPlan,
  deriveRecommendations,
  polygonAreaSqUnits,
  type MinePlannerAdvisor,
  type MinePlannerAdvisorDeps,
} from './mine-planner.js';

export {
  planInputSchema,
  shiftPlanSchema,
  planRecommendationSchema,
  planRecommendationContextSchema,
  polygonSchema,
  equipmentSchema,
  crewMemberSchema,
  type PlanInput,
  type ShiftPlan,
  type TaskAssignment,
  type PlanRecommendation,
  type PlanRecommendationContext,
  type PlanRecommendationKind,
  type Polygon,
  type Equipment,
  type EquipmentKind,
  type CrewMember,
  type LngLat,
  type EvidenceRef,
} from './types.js';

export {
  NOOP_LOGGER,
  type Logger,
  type LmbmPlannerPort,
} from './ports.js';
