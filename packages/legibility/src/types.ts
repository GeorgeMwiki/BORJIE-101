/**
 * `@borjie/legibility` — public type surface.
 *
 * Wave M6. Mirrors the 2-table schema in migration
 * `0037_org_legibility.sql`:
 *
 *   - LegibilitySnapshot   — a row in `legibility_snapshots`.
 *   - LegibilityDelta      — a row in `legibility_deltas`.
 *
 * Plus the typed `LegibilityMap` (the live, queryable map itself),
 * the `LegibilityQuery` shape the query runner accepts, and the
 * `BuilderDeps` interface the snapshot builder calls.
 *
 * Spec: Docs/DESIGN/ORG_LEGIBILITY_SPEC.md §14-21.
 */

// ---------------------------------------------------------------------------
// Domain primitives — minimal structural shapes so we do NOT hard-import
// from @borjie/org-scope (cyclic dep) or @borjie/junior-* (which may not
// exist at build time).
// ---------------------------------------------------------------------------

export type OrgRole =
  | 'owner'
  | 'manager'
  | 'worker'
  | 'customer'
  | 'auditor'
  | 'contractor';

export interface PersonNode {
  readonly personId: string;
  readonly displayName: string;
  readonly primaryRole: OrgRole;
}

export interface RoleEdge {
  readonly personId: string;
  readonly role: OrgRole;
  readonly scopeId: string;
  readonly since: string; // ISO
}

export interface ScopeNode {
  readonly scopeId: string;
  readonly kind: string; // e.g. district, mine, tenant_root
  readonly parentScopeId: string | null;
  readonly displayName: string;
}

export interface CapabilityRef {
  readonly capabilityId: string;
  readonly version: number;
  readonly owner: string | null;
  readonly status: 'live' | 'pilot' | 'deprecated';
}

export interface WorkSubject {
  readonly kind: string;
  readonly id: string;
}

export interface WorkItem {
  readonly subject: WorkSubject;
  readonly kind: string; // e.g. mutation_proposal, conflict, agent_run
  readonly owner: string | null; // person id; never a junior id
  readonly startedAt: string;
  readonly blocker: string | null;
}

/**
 * Junior assignment — INTERNAL ONLY. Mr. Mwikila never surfaces the
 * junior identity on the public map; this axis exists strictly so the
 * dispatch router + the brain can reason about which spawned agent
 * holds which subject.
 */
export interface JuniorAssignment {
  readonly juniorId: string;
  readonly subject: WorkSubject;
  readonly scopeId: string;
  readonly capabilityId: string;
  readonly assignedAt: string;
}

export interface JuniorRouteEdge {
  readonly juniorId: string;
  readonly fromScopeId: string;
  readonly toScopeId: string;
  readonly at: string;
}

// ---------------------------------------------------------------------------
// LegibilityMap — the public live map. §15 of the spec.
// ---------------------------------------------------------------------------

export type LegibilityAxis =
  | 'people'
  | 'roles'
  | 'scopes'
  | 'capabilities'
  | 'currentWork';

export const LEGIBILITY_AXES: ReadonlyArray<LegibilityAxis> = [
  'people',
  'roles',
  'scopes',
  'capabilities',
  'currentWork',
] as const;

export interface PublicLegibilityMap {
  readonly tenantId: string;
  readonly scopeId: string;
  readonly assembledAt: string; // ISO
  readonly people: ReadonlyArray<PersonNode>;
  readonly roles: ReadonlyArray<RoleEdge>;
  readonly scopes: ReadonlyArray<ScopeNode>;
  readonly capabilities: ReadonlyArray<CapabilityRef>;
  readonly currentWork: ReadonlyArray<WorkItem>;
  readonly auditHash: string;
}

/**
 * Internal variant — adds the juniors axis. Returned only to callers
 * that present an `InternalCallerCtx` token.
 */
export interface InternalLegibilityMap extends PublicLegibilityMap {
  readonly juniors: ReadonlyArray<JuniorAssignment>;
  readonly juniorRoutes: ReadonlyArray<JuniorRouteEdge>;
}

// ---------------------------------------------------------------------------
// LegibilitySnapshot — row shape of `legibility_snapshots`.
// ---------------------------------------------------------------------------

export interface LegibilitySnapshot {
  readonly id: string;
  readonly tenantId: string;
  readonly scopeId: string;
  readonly snapshotAt: Date;
  readonly snapshot: PublicLegibilityMap;
  readonly internalSnapshot: InternalLegibilityMap | null;
  readonly axes: ReadonlyArray<LegibilityAxis>;
  readonly auditHash: string;
}

// ---------------------------------------------------------------------------
// LegibilityDelta — row shape of `legibility_deltas`.
// ---------------------------------------------------------------------------

export type LegibilityDeltaKind =
  | 'person.added'
  | 'person.removed'
  | 'role.granted'
  | 'role.revoked'
  | 'scope.added'
  | 'scope.archived'
  | 'capability.activated'
  | 'capability.retired'
  | 'work.started'
  | 'work.completed'
  | 'work.blocked'
  | 'junior.assigned'
  | 'junior.released'
  | 'reconciliation.divergence';

export const LEGIBILITY_DELTA_KINDS: ReadonlyArray<LegibilityDeltaKind> = [
  'person.added',
  'person.removed',
  'role.granted',
  'role.revoked',
  'scope.added',
  'scope.archived',
  'capability.activated',
  'capability.retired',
  'work.started',
  'work.completed',
  'work.blocked',
  'junior.assigned',
  'junior.released',
  'reconciliation.divergence',
] as const;

export interface LegibilityDelta {
  readonly id: string;
  readonly tenantId: string;
  readonly scopeId: string;
  readonly deltaKind: LegibilityDeltaKind;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly recordedAt: Date;
  readonly auditHash: string;
}

// ---------------------------------------------------------------------------
// Query API — §18 of the spec.
// ---------------------------------------------------------------------------

export interface InternalCallerCtx {
  /** A token-typed marker to keep the public/internal flag honest. */
  readonly elevated: true;
  readonly callerId: string;
}

export interface LegibilityQueryFilter {
  readonly role?: OrgRole;
  readonly capabilityId?: string;
  readonly workSubject?: WorkSubject;
  readonly activeOnly?: boolean;
}

export interface LegibilityQuery {
  readonly tenantId: string;
  readonly scopeId?: string;
  readonly axes?: ReadonlyArray<LegibilityAxis>;
  readonly filter?: LegibilityQueryFilter;
  readonly internal?: InternalCallerCtx;
}

export interface LegibilityQueryResult {
  readonly tenantId: string;
  readonly scopeId: string;
  readonly assembledAt: string;
  readonly people: ReadonlyArray<PersonNode>;
  readonly roles: ReadonlyArray<RoleEdge>;
  readonly scopes: ReadonlyArray<ScopeNode>;
  readonly capabilities: ReadonlyArray<CapabilityRef>;
  readonly currentWork: ReadonlyArray<WorkItem>;
  readonly juniors: ReadonlyArray<JuniorAssignment>;
  readonly juniorRoutes: ReadonlyArray<JuniorRouteEdge>;
}

// ---------------------------------------------------------------------------
// Builder deps — the snapshot builder uses these structural interfaces
// rather than hard-importing from sibling packages (the org-scope,
// junior-spawner, and capability-catalogue packages may or may not be
// present at build time).
// ---------------------------------------------------------------------------

export interface OrgScopeReader {
  listPeopleInScope(tenantId: string, scopeId: string): Promise<ReadonlyArray<PersonNode>>;
  listRolesInScope(tenantId: string, scopeId: string): Promise<ReadonlyArray<RoleEdge>>;
  listScopeSubtree(tenantId: string, scopeId: string): Promise<ReadonlyArray<ScopeNode>>;
}

export interface CapabilityReader {
  listLiveCapabilities(
    tenantId: string,
    scopeId: string,
  ): Promise<ReadonlyArray<CapabilityRef>>;
}

export interface WorkReader {
  listCurrentWork(
    tenantId: string,
    scopeId: string,
  ): Promise<ReadonlyArray<WorkItem>>;
}

export interface JuniorReader {
  listAssignments(
    tenantId: string,
    scopeId: string,
  ): Promise<ReadonlyArray<JuniorAssignment>>;
  listRoutes(
    tenantId: string,
    scopeId: string,
  ): Promise<ReadonlyArray<JuniorRouteEdge>>;
}

export interface BuilderDeps {
  readonly orgScope: OrgScopeReader;
  readonly capability: CapabilityReader;
  readonly work: WorkReader;
  /** Optional — if not supplied, the internal axis is left empty. */
  readonly junior?: JuniorReader;
  readonly now: () => Date;
}

// ---------------------------------------------------------------------------
// Repository contracts
// ---------------------------------------------------------------------------

export interface LegibilitySnapshotRepository {
  insert(snapshot: LegibilitySnapshot): Promise<LegibilitySnapshot>;
  latestForScope(
    tenantId: string,
    scopeId: string,
  ): Promise<LegibilitySnapshot | null>;
  listSince(tenantId: string, since: Date): Promise<ReadonlyArray<LegibilitySnapshot>>;
}

export interface LegibilityDeltaRepository {
  append(delta: LegibilityDelta): Promise<LegibilityDelta>;
  listSinceSnapshot(
    tenantId: string,
    scopeId: string,
    snapshotAt: Date,
  ): Promise<ReadonlyArray<LegibilityDelta>>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LEGIBILITY_CONSTANTS = {
  /** Reconciliation cadence — slow path. §16. */
  RECONCILIATION_INTERVAL_MS: 5 * 60 * 1000,
  /** Latency budget for the event-driven fast path. §16. */
  FAST_PATH_P95_LATENCY_MS: 250,
} as const;
