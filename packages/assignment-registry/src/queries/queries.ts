/**
 * Read-side queries — the "what does this user touch?" surface.
 *
 * The lifecycle manager owns writes. Queries are read-only and reach
 * directly into the repository. They MUST NOT mutate the returned
 * objects; in-memory adapters freeze them but downstream Drizzle
 * adapters might not, so we add a final `Object.freeze` at the boundary.
 */

import type {
  Assignment,
  AssignmentRepository,
  Capability,
  ScopeKind,
} from '../types.js';

export interface QueryDeps {
  readonly assignmentRepository: AssignmentRepository;
  readonly now?: () => Date;
}

export interface AssignmentQueryApi {
  myAssignments(
    tenantId: string,
    userId: string,
  ): Promise<ReadonlyArray<Assignment>>;
  whoCanWorkOn(
    tenantId: string,
    scope: ScopeKind,
    scopeRef: string,
    capability: Capability,
  ): Promise<ReadonlyArray<Assignment>>;
  expiringSoon(
    tenantId: string,
    withinMs: number,
  ): Promise<ReadonlyArray<Assignment>>;
  unassignedScopeRefs(
    tenantId: string,
    scope: ScopeKind,
    candidateRefs: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<string>>;
}

export function createAssignmentQueryApi(deps: QueryDeps): AssignmentQueryApi {
  const now = deps.now ?? (() => new Date());

  function isActive(a: Assignment, t: number): boolean {
    if (a.status !== 'active') return false;
    if (a.startsAt.getTime() > t) return false;
    if (a.endsAt && a.endsAt.getTime() <= t) return false;
    return true;
  }

  return {
    async myAssignments(tenantId, userId) {
      const t = now().getTime();
      const all = await deps.assignmentRepository.findByAssignee(
        tenantId,
        userId,
      );
      return Object.freeze(all.filter((a) => isActive(a, t)));
    },

    async whoCanWorkOn(tenantId, scope, scopeRef, capability) {
      const t = now().getTime();
      const matches = await deps.assignmentRepository.findByScope(
        tenantId,
        scope,
        scopeRef,
      );
      return Object.freeze(
        matches.filter(
          (a) => isActive(a, t) && a.capabilities.includes(capability),
        ),
      );
    },

    async expiringSoon(tenantId, withinMs) {
      const t = now().getTime();
      const cutoff = t + withinMs;
      const all = await deps.assignmentRepository.list(tenantId);
      return Object.freeze(
        all.filter((a) => {
          if (!isActive(a, t)) return false;
          if (!a.endsAt) return false;
          const e = a.endsAt.getTime();
          return e > t && e <= cutoff;
        }),
      );
    },

    async unassignedScopeRefs(tenantId, scope, candidateRefs) {
      const t = now().getTime();
      const all = await deps.assignmentRepository.list(tenantId);
      const covered = new Set<string>();
      for (const a of all) {
        if (!isActive(a, t)) continue;
        if (a.scope !== scope) continue;
        // empty scopeRefs = scope-wide grant: every candidate is covered.
        if (a.scopeRefs.length === 0) {
          for (const r of candidateRefs) covered.add(r);
          continue;
        }
        for (const r of a.scopeRefs) {
          if (candidateRefs.includes(r)) covered.add(r);
        }
      }
      return Object.freeze(candidateRefs.filter((r) => !covered.has(r)));
    },
  };
}
