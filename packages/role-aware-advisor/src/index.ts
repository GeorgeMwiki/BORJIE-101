/**
 * `@borjie/role-aware-advisor` — public surface.
 *
 * Role-aware universal real-estate advisor. Composes the existing
 * advisor packages (sustainability, expansion, acquisition, lifecycle,
 * green-angle, estate-department, estate-auto-management) plus four
 * new brain-direct intents (lease, maintenance, market, neighborhood)
 * into a single, role-shaped front door.
 *
 * Pure functions only at this layer; the caller injects:
 *
 *   - `BrainPort`  — multi-LLM synthesizer / single-provider brain
 *   - `DataPort`   — RAG-style snippet fetch (the guard re-checks scope)
 *   - `AuditPort`  — wormAuditStore-compatible append-only sink
 */

export {
  createAdvisor,
  type AdvisorApi,
  type AdvisorDeps,
  type AdviseRequest,
  type AdviseResponse,
  type UserContext,
} from './orchestrator.js';

export {
  ROLES,
  RESOURCE_KINDS,
  PERSONAS,
  getPersona,
  mapWireRoleToRole,
  type Role,
  type Persona,
  type ResourceKind,
} from './roles.js';

export {
  canAccess,
  classifySnippets,
  type AccessDecision,
  type AccessQuery,
  type AccessScope,
  type Classification,
  type SnippetLike,
} from './data-access-guard.js';

export {
  routeQuestion,
  type Intent,
  type SubAdvisorIntent,
  type BrainDirectIntent,
  type SubAdvisorRoute,
} from './router.js';

export {
  generateStartingPoints,
  type StartingPoint,
  type StartingPointContext,
  type UserSnapshot,
  type IsoDate,
  type Season,
} from './starting-points.js';

export {
  redactFields,
  summariseRedactions,
  DEFAULT_PII_KEYS,
  type RedactOptions,
} from './redaction.js';

export {
  recordAudit,
  createInMemoryAuditPort,
  digestString,
  type AuditEntry,
  type AuditPort,
} from './audit.js';

export {
  createEchoBrain,
  createStaticDataPort,
  type BrainPort,
  type BrainRequest,
  type BrainResponse,
  type BrainCitation,
  type DataPort,
  type DataFetchRequest,
  type DataSnippet,
} from './ports.js';
