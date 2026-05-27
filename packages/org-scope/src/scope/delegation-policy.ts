/**
 * Delegation policy (Wave 5 owner-admin-delegation).
 *
 * Pure helpers that enforce the recursive-grant + revocation-cascade
 * invariants for org-scoped admin delegation:
 *
 *   - A grantor may only grant a binding STRICTLY BELOW their own
 *     authority tier (no peer-or-higher grants).
 *   - The new binding's scope must sit at or beneath the grantor's
 *     scope (no cross-scope or upward grants).
 *   - When a binding is revoked, every binding `granted_by` the now-
 *     unbound user falls with it (cascade) — the platform refuses to
 *     leave orphaned downstream grants in place.
 *
 * No I/O — every function takes immutable inputs and returns a verdict
 * value. The caller (binding repository / api-gateway router) actually
 * writes the revocation rows.
 */
import { isAncestor } from '../hierarchy/ancestor-resolver.js';
import type { OrgUnitTree } from '../hierarchy/org-unit-tree-builder.js';
import type {
  AuthorityTier,
  OrgRole,
  ScopeKind,
  UserScopeBinding,
} from '../types.js';

// =============================================================================
// canDelegateBinding
// =============================================================================

export type DelegationVerdictReason =
  | 'allowed'
  | 'grantor_revoked'
  | 'grantor_role_not_admin'
  | 'tier_not_below_grantor'
  | 'scope_outside_grantor'
  | 'tenant_mismatch'
  | 'tenant_root_grant_forbidden';

export interface DelegationVerdict {
  readonly allowed: boolean;
  readonly reason: DelegationVerdictReason;
}

export interface RequestedBinding {
  readonly tenantId: string;
  readonly role: OrgRole;
  readonly scopeKind: ScopeKind;
  readonly orgUnitId: string | null;
  readonly authorityTierMax: AuthorityTier;
}

export interface CanDelegateBindingInput {
  readonly grantor: UserScopeBinding;
  readonly request: RequestedBinding;
  readonly tree: OrgUnitTree;
}

/**
 * Roles that are allowed to delegate at all. Customers, auditors,
 * employees never delegate — only owners and admins do.
 */
const DELEGATING_ROLES: ReadonlySet<OrgRole> = new Set<OrgRole>([
  'owner',
  'admin',
]);

/**
 * Tenant-root scope is reserved for the platform "owner" of a tenant.
 * Even an admin with tier 2 inside an org unit cannot grant a
 * tenant_root binding to anyone — that would silently elevate the
 * grantee out of the grantor's scope.
 */
export function canDelegateBinding(
  input: CanDelegateBindingInput,
): DelegationVerdict {
  const { grantor, request, tree } = input;

  if (grantor.revoked_at !== null) {
    return { allowed: false, reason: 'grantor_revoked' };
  }
  if (grantor.tenant_id !== request.tenantId) {
    return { allowed: false, reason: 'tenant_mismatch' };
  }
  if (!DELEGATING_ROLES.has(grantor.role)) {
    return { allowed: false, reason: 'grantor_role_not_admin' };
  }

  // Tenant_root grants escape the grantor's scope by definition. Only
  // an owner whose binding is tenant_root may grant tenant_root, and
  // even then only at the same tier or below. To keep the recursive-
  // grant invariant simple AND the four-eye property intact, we refuse
  // ALL tenant_root grants from a sub-org admin — only an owner at
  // tenant_root scope may grant tenant_root scope.
  if (request.scopeKind === 'tenant_root') {
    if (grantor.scope_kind !== 'tenant_root') {
      return { allowed: false, reason: 'tenant_root_grant_forbidden' };
    }
    // Even the tenant-root owner cannot grant a peer-or-higher tier.
    if (request.authorityTierMax >= grantor.authority_tier_max) {
      return { allowed: false, reason: 'tier_not_below_grantor' };
    }
    return { allowed: true, reason: 'allowed' };
  }

  // Org_unit (or cross_scope) grants — the requested unit must be
  // self-or-descendant of the grantor's bound unit. A tenant_root
  // grantor sits above every unit, so any org_unit is in-scope.
  if (request.orgUnitId === null) {
    // org_unit scope kind without an org_unit_id is nonsensical.
    return { allowed: false, reason: 'scope_outside_grantor' };
  }

  if (grantor.scope_kind !== 'tenant_root') {
    if (grantor.org_unit_id === null) {
      return { allowed: false, reason: 'scope_outside_grantor' };
    }
    const sameUnit = grantor.org_unit_id === request.orgUnitId;
    const descendant = isAncestor(tree, grantor.org_unit_id, request.orgUnitId);
    if (!sameUnit && !descendant) {
      return { allowed: false, reason: 'scope_outside_grantor' };
    }
  }

  // Tier must be strictly below the grantor's tier. An admin tier 2
  // can grant tier 0 or 1; an admin tier 1 can grant tier 0; an
  // employee (or auditor) is filtered upstream by DELEGATING_ROLES.
  if (request.authorityTierMax >= grantor.authority_tier_max) {
    return { allowed: false, reason: 'tier_not_below_grantor' };
  }

  return { allowed: true, reason: 'allowed' };
}

// =============================================================================
// computeCascadeRevocations
// =============================================================================

export interface CascadeRevocationInput {
  readonly revokedBinding: UserScopeBinding;
  readonly allBindings: ReadonlyArray<UserScopeBinding>;
  /**
   * Optional org-unit tree. When supplied, the cascade is limited to
   * bindings inside the revoked grantor's scope subtree — i.e. a
   * sub-org admin whose grant is revoked only loses the bindings they
   * issued within their OWN scope, not bindings they may have somehow
   * issued elsewhere. When omitted, ALL bindings issued by the
   * revoked grantor (within the tenant) are cascade-revoked.
   */
  readonly tree?: OrgUnitTree;
}

/**
 * Identify the downstream bindings that must be marked revoked
 * because the binding they were issued under no longer exists.
 *
 * Cascade rule:
 *   - tenant matches the revoked grantor's tenant
 *   - binding.granted_by === revoked grantor's user_id
 *   - binding is still active (revoked_at === null)
 *   - when a tree is supplied, the cascaded binding's org_unit sits
 *     at or below the revoked binding's org_unit (no leakage outside)
 *
 * Returns the cascade list ordered by id for determinism. Excludes
 * the originally-revoked binding itself.
 */
export function computeCascadeRevocations(
  input: CascadeRevocationInput,
): ReadonlyArray<UserScopeBinding> {
  const { revokedBinding, allBindings, tree } = input;
  const grantorUserId = revokedBinding.user_id;
  const tenantId = revokedBinding.tenant_id;
  const grantorOrgUnitId = revokedBinding.org_unit_id;
  const grantorIsTenantRoot = revokedBinding.scope_kind === 'tenant_root';

  const out: UserScopeBinding[] = [];
  for (const b of allBindings) {
    if (b.id === revokedBinding.id) continue;
    if (b.tenant_id !== tenantId) continue;
    if (b.revoked_at !== null) continue;
    if (b.granted_by !== grantorUserId) continue;

    if (tree !== undefined && !grantorIsTenantRoot) {
      // Limit cascade to bindings inside the grantor's scope subtree.
      if (grantorOrgUnitId === null) {
        // grantor scope kind is not tenant_root and yet has no
        // org_unit_id — malformed, but refuse to cascade further.
        continue;
      }
      if (b.org_unit_id === null) {
        // Tenant-root binding granted by a sub-org admin — that
        // shouldn't exist, but if it does we DO want to revoke it.
        out.push(b);
        continue;
      }
      const sameUnit = b.org_unit_id === grantorOrgUnitId;
      const descendant = isAncestor(tree, grantorOrgUnitId, b.org_unit_id);
      if (!sameUnit && !descendant) continue;
    }

    out.push(b);
  }

  // Stable order — id sort.
  out.sort((a, b) => a.id.localeCompare(b.id));
  return Object.freeze(out);
}
