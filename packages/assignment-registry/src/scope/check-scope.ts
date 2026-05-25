/**
 * `checkScope` — the heart of ReBAC-style access control.
 *
 * The check walks: user → active assignments → matching scope+scopeRef →
 * required capability. Default deny: if no assignment grants the
 * capability for the specific scopeRef, the result is 'deny'.
 *
 * Cascade evaluation is optional. If `parentChain` is supplied, the
 * guard ALSO checks for an assignment at any parent level whose cascade
 * rule covers the requested capability. This is how a district admin
 * can `view` a parcel without an explicit per-parcel assignment.
 *
 * Per-request cache:
 *   The guard's internal `_loadActiveAssignments` does ONE repo read
 *   per (tenant, user) tuple per request. Callers in a hot loop can
 *   re-use the same `ScopeGuard` instance — it memoises within its
 *   lifetime. For per-request safety, the api-gateway middleware
 *   constructs a fresh guard for every request.
 */

import type {
  Assignment,
  AssignmentRepository,
  CascadeRule,
  Capability,
  Decision,
  ScopeCheckInput,
  ScopeCheckResult,
  ScopeKind,
} from '../types.js';
import { DEFAULT_CASCADE_RULES } from '../types.js';

export interface ScopeGuardDeps {
  readonly assignmentRepository: AssignmentRepository;
  /**
   * Optional override of cascade rules. When omitted the defaults from
   * `types.ts` apply. Tenants set their own via elastic-config.
   */
  readonly cascadeRules?: ReadonlyArray<CascadeRule>;
  /**
   * Provide the current time for testability. Defaults to `Date.now`.
   * The guard uses this to evaluate expiry / pause windows.
   */
  readonly now?: () => Date;
}

export interface ScopeGuard {
  check(input: ScopeCheckInput): Promise<ScopeCheckResult>;
  /** Eagerly load assignments for a (tenant, user) tuple. */
  primeUser(tenantId: string, userId: string): Promise<void>;
  /** Drop the per-request cache. */
  reset(): void;
}

export function createScopeGuard(deps: ScopeGuardDeps): ScopeGuard {
  const cascadeRules = deps.cascadeRules ?? DEFAULT_CASCADE_RULES;
  const now = deps.now ?? (() => new Date());
  const cache = new Map<string, ReadonlyArray<Assignment>>();

  function cacheKey(tenantId: string, userId: string): string {
    return `${tenantId}::${userId}`;
  }

  async function loadActiveAssignments(
    tenantId: string,
    userId: string,
  ): Promise<ReadonlyArray<Assignment>> {
    const key = cacheKey(tenantId, userId);
    const hit = cache.get(key);
    if (hit) return hit;
    const all = await deps.assignmentRepository.findByAssignee(
      tenantId,
      userId,
    );
    const t = now().getTime();
    const active = all.filter((a) => {
      if (a.status !== 'active') return false;
      if (a.startsAt.getTime() > t) return false;
      if (a.endsAt && a.endsAt.getTime() <= t) return false;
      return true;
    });
    const frozen = Object.freeze(active);
    cache.set(key, frozen);
    return frozen;
  }

  function directMatch(
    assignment: Assignment,
    input: ScopeCheckInput,
  ): boolean {
    if (assignment.scope !== input.scope) return false;
    if (!assignment.capabilities.includes(input.action)) return false;
    // empty scopeRefs == scope-wide grant (e.g. district admin sees ALL
    // districts in tenant).
    if (assignment.scopeRefs.length === 0) return true;
    return assignment.scopeRefs.includes(input.scopeRef);
  }

  function cascadeMatch(
    assignment: Assignment,
    input: ScopeCheckInput,
  ): boolean {
    if (!input.parentChain || input.parentChain.length === 0) return false;
    for (const parent of input.parentChain) {
      if (assignment.scope !== parent.scope) continue;
      // scopeRefs match: either scope-wide or the specific parent ref
      const scopeRefMatches =
        assignment.scopeRefs.length === 0 ||
        assignment.scopeRefs.includes(parent.scopeRef);
      if (!scopeRefMatches) continue;
      // Find the cascade rule for this (parent → child) edge.
      const rule = cascadeRules.find(
        (r) => r.parentScope === parent.scope && r.childScope === input.scope,
      );
      if (!rule) continue;
      // The cascading-capabilities list is the FILTER — only listed
      // capabilities cascade. The assignment must ALSO hold the action
      // (parent admin doesn't auto-gain write on child unless the rule
      // explicitly lists it AND the assignment has it).
      if (!rule.cascadedCapabilities.includes(input.action)) continue;
      if (!assignment.capabilities.includes(input.action)) continue;
      return true;
    }
    return false;
  }

  return {
    async check(input) {
      const assignments = await loadActiveAssignments(
        input.tenantId,
        input.userId,
      );
      if (assignments.length === 0) {
        return {
          decision: 'deny' as Decision,
          reason: 'no_active_assignments',
          matchedAssignmentId: null,
        };
      }
      // Direct match takes precedence — it's a stronger signal.
      for (const a of assignments) {
        if (directMatch(a, input)) {
          return {
            decision: 'allow' as Decision,
            reason: 'direct_assignment',
            matchedAssignmentId: a.id,
          };
        }
      }
      // Fall through to cascade.
      for (const a of assignments) {
        if (cascadeMatch(a, input)) {
          return {
            decision: 'allow' as Decision,
            reason: 'cascade_assignment',
            matchedAssignmentId: a.id,
          };
        }
      }
      return {
        decision: 'deny' as Decision,
        reason: 'no_matching_assignment',
        matchedAssignmentId: null,
      };
    },
    async primeUser(tenantId, userId) {
      await loadActiveAssignments(tenantId, userId);
    },
    reset() {
      cache.clear();
    },
  };
}

/**
 * Convenience predicate for tests + UI guard rails.
 */
export function userHasCapabilityOnAny(
  assignments: ReadonlyArray<Assignment>,
  scope: ScopeKind,
  capability: Capability,
): boolean {
  return assignments.some(
    (a) =>
      a.status === 'active' &&
      a.scope === scope &&
      a.capabilities.includes(capability),
  );
}
