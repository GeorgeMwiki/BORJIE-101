/**
 * `@borjie/assignment-registry` — public barrel.
 *
 * The package implements ReBAC-style scoped access control with a
 * pure-function scope guard, an append-only event log, and a small set
 * of read-side queries. Storage is pluggable: an in-memory adapter
 * ships in-package for tests; production wires a Drizzle adapter from
 * `services/api-gateway`.
 *
 * Headline factory:
 *   createAssignmentRegistry({ assignmentRepository, eventRepository, idGen })
 *
 * which returns one composed object with `.scope`, `.management`, and
 * `.queries`. Most callers only need the headline; advanced callers
 * (composition-root tests, the api-gateway router) reach in for the
 * sub-factories.
 */

// Types — re-export the entire contract so consumers don't import
// './types.js' directly.
export * from './types.js';

// Scope guard.
export {
  createScopeGuard,
  userHasCapabilityOnAny,
  type ScopeGuard,
  type ScopeGuardDeps,
} from './scope/index.js';

// Lifecycle management.
export {
  createLifecycleManager,
  type LifecycleManager,
  type LifecycleDeps,
} from './management/index.js';

// Queries.
export {
  createAssignmentQueryApi,
  type AssignmentQueryApi,
  type QueryDeps,
} from './queries/index.js';

// In-memory adapters — exported so tests + dev compositions can wire
// them without reaching into an internal path.
export {
  createInMemoryAssignmentRepository,
  createInMemoryAssignmentEventRepository,
} from './internal/in-memory-repos.js';

// IdGen.
export { createIdGen, type IdGen } from './internal/id.js';

// ──────────────────────────────────────────────────────────────────────
// Composed headline.
// ──────────────────────────────────────────────────────────────────────

import type { ScopeGuard, ScopeGuardDeps } from './scope/index.js';
import type { LifecycleManager } from './management/index.js';
import type { AssignmentQueryApi } from './queries/index.js';
import { createScopeGuard } from './scope/index.js';
import { createLifecycleManager } from './management/index.js';
import { createAssignmentQueryApi } from './queries/index.js';
import type {
  AssignmentEventRepository,
  AssignmentRepository,
  CascadeRule,
} from './types.js';
import type { IdGen } from './internal/id.js';
import { createIdGen } from './internal/id.js';

export interface CreateAssignmentRegistryArgs {
  readonly assignmentRepository: AssignmentRepository;
  readonly eventRepository: AssignmentEventRepository;
  readonly idGen?: IdGen;
  readonly cascadeRules?: ReadonlyArray<CascadeRule>;
  readonly now?: () => Date;
}

export interface AssignmentRegistry {
  readonly scope: ScopeGuard;
  readonly management: LifecycleManager;
  readonly queries: AssignmentQueryApi;
}

export function createAssignmentRegistry(
  args: CreateAssignmentRegistryArgs,
): AssignmentRegistry {
  const idGen = args.idGen ?? createIdGen();
  const now = args.now;
  const scopeArgs: ScopeGuardDeps = {
    assignmentRepository: args.assignmentRepository,
    ...(args.cascadeRules !== undefined ? { cascadeRules: args.cascadeRules } : {}),
    ...(now !== undefined ? { now } : {}),
  };
  const scope = createScopeGuard(scopeArgs);
  const management = createLifecycleManager({
    assignmentRepository: args.assignmentRepository,
    eventRepository: args.eventRepository,
    idGen,
    ...(now !== undefined ? { now } : {}),
  });
  const queries = createAssignmentQueryApi({
    assignmentRepository: args.assignmentRepository,
    ...(now !== undefined ? { now } : {}),
  });
  return { scope, management, queries };
}
