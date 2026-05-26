/**
 * Query runner — projects a snapshot to a typed result.
 *
 * Wave M6. §18 of the spec.
 *
 * The runner reads the latest snapshot for the requested scope,
 * applies the requested filter in-memory, and projects to the
 * requested axes. Internal axes (`juniors`, `juniorRoutes`) are
 * returned only if the caller presents an `InternalCallerCtx` token.
 */

import type {
  CapabilityRef,
  JuniorAssignment,
  JuniorRouteEdge,
  LegibilityQuery,
  LegibilityQueryResult,
  LegibilitySnapshot,
  LegibilitySnapshotRepository,
  PersonNode,
  RoleEdge,
  ScopeNode,
  WorkItem,
} from '../types.js';

export class LegibilityQueryError extends Error {
  public readonly code: 'snapshot_missing' | 'internal_token_required';
  constructor(code: LegibilityQueryError['code'], message: string) {
    super(message);
    this.name = 'LegibilityQueryError';
    this.code = code;
  }
}

interface QueryDeps {
  readonly snapshots: LegibilitySnapshotRepository;
}

/**
 * Run a query against the latest snapshot for the requested
 * (tenant, scope). Returns the projected, filtered, optionally-internal
 * result.
 */
export async function runLegibilityQuery(
  query: LegibilityQuery,
  deps: QueryDeps,
): Promise<LegibilityQueryResult> {
  const scopeId = query.scopeId ?? 'tenant_root';
  const snapshot = await deps.snapshots.latestForScope(
    query.tenantId,
    scopeId,
  );
  if (snapshot === null) {
    throw new LegibilityQueryError(
      'snapshot_missing',
      `no snapshot found for ${query.tenantId} / ${scopeId}`,
    );
  }
  return projectSnapshot(snapshot, query);
}

/**
 * Pure projector — turns a snapshot + query into a query result. Used
 * directly by tests; production code goes via `runLegibilityQuery`.
 */
export function projectSnapshot(
  snapshot: LegibilitySnapshot,
  query: LegibilityQuery,
): LegibilityQueryResult {
  const axes = new Set(
    query.axes ?? ['people', 'roles', 'scopes', 'capabilities', 'currentWork'],
  );
  const filter = query.filter;
  const map = snapshot.snapshot;

  const people: ReadonlyArray<PersonNode> = axes.has('people')
    ? filterPeople(map.people, filter, map.roles)
    : [];
  const roles: ReadonlyArray<RoleEdge> = axes.has('roles')
    ? filterRoles(map.roles, filter)
    : [];
  const scopes: ReadonlyArray<ScopeNode> = axes.has('scopes') ? map.scopes : [];
  const capabilities: ReadonlyArray<CapabilityRef> = axes.has('capabilities')
    ? filterCapabilities(map.capabilities, filter)
    : [];
  const currentWork: ReadonlyArray<WorkItem> = axes.has('currentWork')
    ? filterWork(map.currentWork, filter)
    : [];

  let juniors: ReadonlyArray<JuniorAssignment> = [];
  let juniorRoutes: ReadonlyArray<JuniorRouteEdge> = [];
  if (query.internal !== undefined) {
    if (query.internal.elevated !== true) {
      throw new LegibilityQueryError(
        'internal_token_required',
        'internal axes require an elevated InternalCallerCtx',
      );
    }
    if (snapshot.internalSnapshot !== null) {
      juniors = snapshot.internalSnapshot.juniors;
      juniorRoutes = snapshot.internalSnapshot.juniorRoutes;
    }
  }

  return Object.freeze({
    tenantId: snapshot.tenantId,
    scopeId: snapshot.scopeId,
    assembledAt: map.assembledAt,
    people,
    roles,
    scopes,
    capabilities,
    currentWork,
    juniors,
    juniorRoutes,
  });
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function filterPeople(
  people: ReadonlyArray<PersonNode>,
  filter: LegibilityQuery['filter'],
  roles: ReadonlyArray<RoleEdge>,
): ReadonlyArray<PersonNode> {
  if (filter === undefined || filter.role === undefined) return people;
  const allowed = new Set(
    roles.filter((r) => r.role === filter.role).map((r) => r.personId),
  );
  return people.filter((p) => allowed.has(p.personId));
}

function filterRoles(
  roles: ReadonlyArray<RoleEdge>,
  filter: LegibilityQuery['filter'],
): ReadonlyArray<RoleEdge> {
  if (filter === undefined || filter.role === undefined) return roles;
  return roles.filter((r) => r.role === filter.role);
}

function filterCapabilities(
  caps: ReadonlyArray<CapabilityRef>,
  filter: LegibilityQuery['filter'],
): ReadonlyArray<CapabilityRef> {
  if (filter === undefined || filter.capabilityId === undefined) return caps;
  return caps.filter((c) => c.capabilityId === filter.capabilityId);
}

function filterWork(
  work: ReadonlyArray<WorkItem>,
  filter: LegibilityQuery['filter'],
): ReadonlyArray<WorkItem> {
  if (filter === undefined) return work;
  let out = work;
  if (filter.workSubject !== undefined) {
    const ws = filter.workSubject;
    out = out.filter(
      (w) => w.subject.kind === ws.kind && w.subject.id === ws.id,
    );
  }
  if (filter.activeOnly === true) {
    out = out.filter((w) => w.blocker === null);
  }
  return out;
}
