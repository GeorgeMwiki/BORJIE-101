/**
 * Snapshot builder — assembles a `LegibilitySnapshot` from the
 * underlying readers (org-scope, capabilities, work, optional junior).
 *
 * Wave M6. §15-§16 of the spec.
 *
 * The builder accepts an opaque `BuilderDeps` shape; it does NOT
 * import from sibling packages (the junior + capability packages may
 * not exist at build time). Consumers wire whatever readers they
 * already have.
 *
 * The builder is `async` because the readers are async (they hit
 * Postgres in production). For deterministic tests, pass synchronous
 * stubs that return Promise.resolve(...).
 */

import { randomUUID } from 'node:crypto';
import { computeLegibilityAuditHash } from '../audit/audit-chain-link.js';
import type {
  BuilderDeps,
  InternalLegibilityMap,
  LegibilitySnapshot,
  LegibilityAxis,
  PublicLegibilityMap,
} from '../types.js';

interface BuildSnapshotInput {
  readonly tenantId: string;
  readonly scopeId: string;
  /** Subset of axes to assemble. Default: all five public axes. */
  readonly axes?: ReadonlyArray<LegibilityAxis>;
  /** Compute the internal variant alongside (with juniors)? */
  readonly includeInternal?: boolean;
}

export async function buildLegibilitySnapshot(
  input: BuildSnapshotInput,
  deps: BuilderDeps,
): Promise<LegibilitySnapshot> {
  const axes = input.axes ?? ['people', 'roles', 'scopes', 'capabilities', 'currentWork'];
  const now = deps.now();

  const people = axes.includes('people')
    ? await deps.orgScope.listPeopleInScope(input.tenantId, input.scopeId)
    : [];
  const roles = axes.includes('roles')
    ? await deps.orgScope.listRolesInScope(input.tenantId, input.scopeId)
    : [];
  const scopes = axes.includes('scopes')
    ? await deps.orgScope.listScopeSubtree(input.tenantId, input.scopeId)
    : [];
  const capabilities = axes.includes('capabilities')
    ? await deps.capability.listLiveCapabilities(input.tenantId, input.scopeId)
    : [];
  const currentWork = axes.includes('currentWork')
    ? await deps.work.listCurrentWork(input.tenantId, input.scopeId)
    : [];

  const publicMap: PublicLegibilityMap = Object.freeze({
    tenantId: input.tenantId,
    scopeId: input.scopeId,
    assembledAt: now.toISOString(),
    people,
    roles,
    scopes,
    capabilities,
    currentWork,
    auditHash: computeLegibilityAuditHash({
      op: 'legibility.snapshot.public',
      tenantId: input.tenantId,
      scopeId: input.scopeId,
      assembledAtMs: now.getTime(),
      counts: {
        people: people.length,
        roles: roles.length,
        scopes: scopes.length,
        capabilities: capabilities.length,
        currentWork: currentWork.length,
      },
    }),
  });

  let internalMap: InternalLegibilityMap | null = null;
  if (input.includeInternal === true && deps.junior !== undefined) {
    const juniors = await deps.junior.listAssignments(
      input.tenantId,
      input.scopeId,
    );
    const juniorRoutes = await deps.junior.listRoutes(
      input.tenantId,
      input.scopeId,
    );
    internalMap = Object.freeze({
      ...publicMap,
      juniors,
      juniorRoutes,
    });
  }

  const id = randomUUID();
  const snapshot: LegibilitySnapshot = Object.freeze({
    id,
    tenantId: input.tenantId,
    scopeId: input.scopeId,
    snapshotAt: now,
    snapshot: publicMap,
    internalSnapshot: internalMap,
    axes,
    auditHash: computeLegibilityAuditHash(
      {
        op: 'legibility.snapshot.row',
        id,
        scopeId: input.scopeId,
        assembledAtMs: now.getTime(),
      },
      publicMap.auditHash,
    ),
  });
  return snapshot;
}
