/**
 * Visibility filter builder (Wave 18X §3 + §8).
 *
 * Pure utility that produces a compact `VisibilityFilter` payload from
 * the active user's bindings + the org-unit tree. Downstream repositories
 * translate the payload into a Drizzle/SQL WHERE clause.
 *
 * The filter is deliberately *data-only* — no SQL fragments leak out
 * of this package. That keeps the module testable in isolation and lets
 * each repository decide how to combine the filter with its own
 * predicates.
 */

import { resolveDescendants } from '../hierarchy/descendant-resolver.js';
import type { OrgUnitTree } from '../hierarchy/org-unit-tree-builder.js';
import type {
  AuthorityTier,
  UserScopeBinding,
  VisibilityFilter,
} from '../types.js';

export interface BuildVisibilityFilterInput {
  readonly tenantId: string;
  readonly bindings: ReadonlyArray<UserScopeBinding>;
  readonly tree: OrgUnitTree;
  /** When set, restrict to a single binding (the user has explicitly switched context). */
  readonly activeBindingId?: string;
}

export interface BuildVisibilityFilterResult {
  readonly filter: VisibilityFilter;
  readonly authority_tier_max: AuthorityTier;
  readonly is_tenant_root: boolean;
}

/**
 * Build the `VisibilityFilter` payload for a user given their bindings.
 *
 * Rules:
 *   - Any non-revoked `tenant_root` binding → tenant-wide visibility,
 *     `org_unit_ids = []`, `include_descendants = false` (no need —
 *     the absence of org-unit filter is the wildcard).
 *   - Otherwise, the union of org-unit ids from non-revoked
 *     `org_unit` / `cross_scope` bindings, expanded with descendants.
 *   - `authority_tier_max` is the MAX over selected bindings, capped
 *     to the user's tenant binding ceiling (a sub-org admin cannot
 *     bypass a tenant-wide demotion).
 */
export function buildVisibilityFilter(
  input: BuildVisibilityFilterInput,
): BuildVisibilityFilterResult {
  const { tenantId, bindings, tree, activeBindingId } = input;
  const active = bindings.filter((b) => b.revoked_at === null && b.tenant_id === tenantId);
  const selected =
    activeBindingId === undefined
      ? active
      : active.filter((b) => b.id === activeBindingId);

  if (selected.length === 0) {
    // No bindings → nothing visible. Tenant-root sentinel ids = []
    // with a tier max of 0 (read-only) is the safe default.
    return {
      filter: {
        tenant_id: tenantId,
        org_unit_ids: Object.freeze([] as ReadonlyArray<string>),
        include_descendants: false,
      },
      authority_tier_max: 0,
      is_tenant_root: false,
    };
  }

  const tenantRoot = selected.find((b) => b.scope_kind === 'tenant_root');
  if (tenantRoot !== undefined) {
    return {
      filter: {
        tenant_id: tenantId,
        org_unit_ids: Object.freeze([] as ReadonlyArray<string>),
        include_descendants: false,
      },
      authority_tier_max: tenantRoot.authority_tier_max,
      is_tenant_root: true,
    };
  }

  const directIds = new Set<string>();
  for (const binding of selected) {
    if (binding.org_unit_id !== null) {
      directIds.add(binding.org_unit_id);
    }
  }

  const expanded = new Set<string>(directIds);
  for (const id of directIds) {
    const descendants = resolveDescendants(tree, id);
    if (descendants !== null) {
      for (const d of descendants) {
        expanded.add(d.id);
      }
    }
  }

  let tierMax: AuthorityTier = 0;
  for (const binding of selected) {
    if (binding.authority_tier_max > tierMax) {
      tierMax = binding.authority_tier_max;
    }
  }

  return {
    filter: {
      tenant_id: tenantId,
      org_unit_ids: Object.freeze([...expanded].sort() as ReadonlyArray<string>),
      include_descendants: true,
    },
    authority_tier_max: tierMax,
    is_tenant_root: false,
  };
}
