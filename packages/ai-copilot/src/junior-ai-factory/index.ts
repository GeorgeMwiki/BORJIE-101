/**
 * junior-ai-factory barrel — Wave 28.
 *
 * Self-service Junior-AI provisioning for team leads. Every junior inherits
 * a strict subset of the tenant AutonomyPolicy and is lifecycle-bounded.
 */
export {
  JuniorAIFactoryService,
  InMemoryJuniorAIRepository,
  validatePolicySubset,
} from './service.js';
export type { JuniorAIFactoryServiceDeps } from './service.js';
export {
  DailyActionCapExceededError,
  JuniorAINotActiveError,
  PolicySubsetViolationError,
} from './types.js';
export type {
  JuniorAIAuditEvent,
  JuniorAIAuditKind,
  JuniorAILifecycle,
  JuniorAIRecord,
  JuniorAIRepository,
  JuniorAIScopePatch,
  JuniorAISpec,
  JuniorAIStatus,
  ListJuniorAIFilters,
  MemoryScope,
} from './types.js';
