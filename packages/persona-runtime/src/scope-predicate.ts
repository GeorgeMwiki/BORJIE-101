/**
 * Scope predicate evaluator.
 *
 * Persona scope predicates declare *the slice of data this persona is
 * allowed to see/act on*. They're rendered into a small, deterministic
 * AST (`ScopePredicate`) on the persona row and evaluated at runtime
 * against an `AuthorizationContext`.
 *
 * Two evaluation paths:
 *
 *   1. `evaluateScopePredicate({predicate, ctx, target})` — returns a
 *      pure pass/fail verdict for a candidate target row. Used by the
 *      tool-catalog gate and by application repositories that want a
 *      defence-in-depth check above the database RLS.
 *
 *   2. `renderScopeFilter({predicate, ctx})` — returns a key/value
 *      filter object the repository can use to build a Drizzle WHERE
 *      clause without leaking through templating. Returns `{ block:
 *      true }` when the predicate is `kind: 'none'`.
 *
 * The evaluator is intentionally generic — no jurisdiction strings.
 * TRC/hotel/university/etc. all parameterise via `module`, `org_id`,
 * `region` placeholders.
 */

import type {
  AuthorizationContext,
  ScopePredicate,
  ScopeKind,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Target row shape — the minimum fields a row needs to be checked.
// ─────────────────────────────────────────────────────────────────────

export interface ScopeTargetRow {
  readonly tenantId: string;
  readonly orgId?: string | undefined;
  readonly moduleId?: string | undefined;
  readonly regionId?: string | undefined;
  readonly ownerUserId?: string | undefined;
}

// ─────────────────────────────────────────────────────────────────────
// Pass/fail evaluation
// ─────────────────────────────────────────────────────────────────────

export interface ScopeEvaluationResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly kind: ScopeKind;
}

/**
 * Evaluate a scope predicate against a target row. Pure function — no
 * side effects, no I/O.
 *
 * Semantics by kind:
 *
 *   - tenant_scope    → tenant_id must match ctx.tenantId
 *   - org_scope       → target.orgId must equal ctx.orgId
 *   - module_scope    → target.moduleId must equal predicate.module
 *                       (predicate.module is the persona-bound module;
 *                        if absent we fall back to ctx.moduleId)
 *   - region_scope    → target.regionId must equal predicate.region
 *                       (or ctx.regionId)
 *   - own_records     → target.ownerUserId must equal ctx.userId
 *   - none            → always FALSE
 *   - all             → always TRUE (subject to tenant_id check)
 */
export function evaluateScopePredicate(args: {
  readonly predicate: ScopePredicate;
  readonly ctx: AuthorizationContext;
  readonly target: ScopeTargetRow;
}): ScopeEvaluationResult {
  const { predicate, ctx, target } = args;

  // Hard tenant-isolation rail. The brain never crosses tenants except
  // via the platform-tier `all` predicate (used only for sovereign-DP
  // analytics).
  if (predicate.kind !== 'all' && target.tenantId !== ctx.tenantId) {
    return {
      allowed: false,
      reason: `tenant-isolation: target.tenantId=${target.tenantId} ≠ ctx.tenantId=${ctx.tenantId}`,
      kind: predicate.kind,
    };
  }

  switch (predicate.kind) {
    case 'none':
      return { allowed: false, reason: 'persona scope = none', kind: 'none' };

    case 'all':
      return { allowed: true, kind: 'all' };

    case 'tenant_scope':
      return { allowed: true, kind: 'tenant_scope' };

    case 'org_scope': {
      const expected = predicate.org_id ?? ctx.orgId;
      if (!expected) {
        return {
          allowed: false,
          reason: 'org_scope predicate has no org_id and ctx.orgId is undefined',
          kind: 'org_scope',
        };
      }
      if (target.orgId === expected) {
        return { allowed: true, kind: 'org_scope' };
      }
      return {
        allowed: false,
        reason: `org_scope mismatch: target.orgId=${target.orgId ?? '∅'} ≠ ${expected}`,
        kind: 'org_scope',
      };
    }

    case 'module_scope': {
      const expected = predicate.module ?? ctx.moduleId;
      if (!expected) {
        return {
          allowed: false,
          reason:
            'module_scope predicate has no module and ctx.moduleId is undefined',
          kind: 'module_scope',
        };
      }
      if (target.moduleId === expected) {
        return { allowed: true, kind: 'module_scope' };
      }
      return {
        allowed: false,
        reason: `module_scope mismatch: target.moduleId=${target.moduleId ?? '∅'} ≠ ${expected}`,
        kind: 'module_scope',
      };
    }

    case 'region_scope': {
      const expected = predicate.region ?? ctx.regionId;
      if (!expected) {
        return {
          allowed: false,
          reason:
            'region_scope predicate has no region and ctx.regionId is undefined',
          kind: 'region_scope',
        };
      }
      if (target.regionId === expected) {
        return { allowed: true, kind: 'region_scope' };
      }
      return {
        allowed: false,
        reason: `region_scope mismatch: target.regionId=${target.regionId ?? '∅'} ≠ ${expected}`,
        kind: 'region_scope',
      };
    }

    case 'own_records': {
      const expected = predicate.user_id ?? ctx.userId;
      if (target.ownerUserId === expected) {
        return { allowed: true, kind: 'own_records' };
      }
      return {
        allowed: false,
        reason: `own_records mismatch: target.ownerUserId=${target.ownerUserId ?? '∅'} ≠ ${expected}`,
        kind: 'own_records',
      };
    }

    default: {
      // Exhaustiveness — TypeScript will flag if SCOPE_KINDS expands
      // without a matching arm.
      const _exhaustive: never = predicate.kind;
      return {
        allowed: false,
        reason: `unknown scope kind: ${_exhaustive}`,
        kind: predicate.kind,
      };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Filter rendering — for repository WHERE-clause builders
// ─────────────────────────────────────────────────────────────────────

export interface ScopeFilter {
  /** When TRUE the repository must short-circuit to an empty result. */
  readonly block: boolean;
  /** When TRUE, no scoping is needed beyond tenant_id. */
  readonly platformWide?: boolean;
  /** Tenant id filter (always set unless platformWide). */
  readonly tenantId?: string;
  readonly orgId?: string;
  readonly moduleId?: string;
  readonly regionId?: string;
  readonly ownerUserId?: string;
}

/**
 * Project a predicate into a flat filter object the repository layer
 * can compose into a WHERE clause. The application is responsible for
 * doing the right thing with the `block` sentinel.
 */
export function renderScopeFilter(args: {
  readonly predicate: ScopePredicate;
  readonly ctx: AuthorizationContext;
}): ScopeFilter {
  const { predicate, ctx } = args;
  switch (predicate.kind) {
    case 'none':
      return { block: true };
    case 'all':
      return { block: false, platformWide: true };
    case 'tenant_scope':
      return { block: false, tenantId: ctx.tenantId };
    case 'org_scope': {
      const orgId = predicate.org_id ?? ctx.orgId;
      return orgId !== undefined
        ? { block: false, tenantId: ctx.tenantId, orgId }
        : { block: false, tenantId: ctx.tenantId };
    }
    case 'module_scope': {
      const moduleId = predicate.module ?? ctx.moduleId;
      return moduleId !== undefined
        ? { block: false, tenantId: ctx.tenantId, moduleId }
        : { block: false, tenantId: ctx.tenantId };
    }
    case 'region_scope': {
      const regionId = predicate.region ?? ctx.regionId;
      return regionId !== undefined
        ? { block: false, tenantId: ctx.tenantId, regionId }
        : { block: false, tenantId: ctx.tenantId };
    }
    case 'own_records':
      return {
        block: false,
        tenantId: ctx.tenantId,
        ownerUserId: predicate.user_id ?? ctx.userId,
      };
    default: {
      const _exhaustive: never = predicate.kind;
      void _exhaustive;
      return { block: true };
    }
  }
}
