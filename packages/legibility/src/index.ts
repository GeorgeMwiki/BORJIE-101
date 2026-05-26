/**
 * `@borjie/legibility` — public surface.
 *
 * Wave M6. The live, queryable, brand-locked org map. People × roles
 * × scopes × capabilities × current work, refreshed by event-driven
 * deltas and a 5-minute reconciliation. Public + internal variants;
 * juniors are NEVER exposed on the public surface.
 *
 * Source of truth:
 *   - Docs/DESIGN/ORG_LEGIBILITY_SPEC.md §14-21
 *   - packages/database/drizzle/0037_org_legibility.sql
 *
 * Public modules:
 *   - types          — every legibility envelope + builder deps
 *                       interface + query API shape + repo contracts
 *   - builder        — snapshot builder + delta applier (pure)
 *   - queries        — filterable query runner + pure projector
 *   - repositories   — in-memory snapshot + delta repositories
 *   - audit          — chain-link hashing
 */

// ── Types ────────────────────────────────────────────────────────────
export type {
  BuilderDeps,
  CapabilityReader,
  CapabilityRef,
  InternalCallerCtx,
  InternalLegibilityMap,
  JuniorAssignment,
  JuniorReader,
  JuniorRouteEdge,
  LegibilityAxis,
  LegibilityDelta,
  LegibilityDeltaKind,
  LegibilityDeltaRepository,
  LegibilityQuery,
  LegibilityQueryFilter,
  LegibilityQueryResult,
  LegibilitySnapshot,
  LegibilitySnapshotRepository,
  OrgRole,
  OrgScopeReader,
  PersonNode,
  PublicLegibilityMap,
  RoleEdge,
  ScopeNode,
  WorkItem,
  WorkReader,
  WorkSubject,
} from './types.js';
export {
  LEGIBILITY_AXES,
  LEGIBILITY_CONSTANTS,
  LEGIBILITY_DELTA_KINDS,
} from './types.js';

// ── Builder ──────────────────────────────────────────────────────────
export { buildLegibilitySnapshot } from './builder/snapshot-builder.js';
export {
  applyInternalDelta,
  applyPublicDelta,
  DeltaApplyError,
} from './builder/delta-applier.js';

// ── Queries ──────────────────────────────────────────────────────────
export {
  LegibilityQueryError,
  projectSnapshot,
  runLegibilityQuery,
} from './queries/query-runner.js';

// ── Repositories ─────────────────────────────────────────────────────
export { createInMemorySnapshotRepository } from './repositories/snapshot.js';
export {
  createInMemoryDeltaRepository,
  type AppendDeltaInput,
} from './repositories/delta.js';

// ── Audit ────────────────────────────────────────────────────────────
export {
  computeLegibilityAuditHash,
  GENESIS_HASH,
} from './audit/audit-chain-link.js';
