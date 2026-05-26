/**
 * Resolve user scope (Wave 18X §3 + §5).
 *
 * Top-level orchestrator that produces a `ResolvedScope` for a given
 * user from their bindings, the tenant's org-unit tree, and the
 * tenant's terminology overrides.
 *
 * Pure: no DB calls. The caller fetches inputs (bindings + units +
 * overrides) and feeds them in. Sibling-package retrofits will typically
 * cache the result for the duration of a request.
 */

import type { OrgUnitTree } from '../hierarchy/org-unit-tree-builder.js';
import { resolveTerminologyForScope } from '../terminology/resolver.js';
import type {
  ResolvedScope,
  ResolvedScopeKind,
  TerminologyOverride,
  UserScopeBinding,
} from '../types.js';
import { buildVisibilityFilter } from './visibility-filter.js';

export interface ResolveUserScopeInput {
  readonly tenantId: string;
  readonly bindings: ReadonlyArray<UserScopeBinding>;
  readonly tree: OrgUnitTree;
  readonly terminologyOverrides: ReadonlyArray<TerminologyOverride>;
  /** Optional — which binding the user has explicitly activated. */
  readonly activeBindingId?: string;
  /** Recipes published in the tenant. The resolver filters by audience+scope. */
  readonly publishedRecipes?: ReadonlyArray<{
    readonly recipe_id: string;
    readonly org_unit_id: string | null;
  }>;
  /** Juniors registered for the tenant. */
  readonly publishedJuniors?: ReadonlyArray<{
    readonly junior_id: string;
    readonly org_unit_id: string | null;
  }>;
}

export function resolveUserScope(input: ResolveUserScopeInput): ResolvedScope {
  const {
    tenantId,
    bindings,
    tree,
    terminologyOverrides,
    activeBindingId,
    publishedRecipes,
    publishedJuniors,
  } = input;

  const { filter, authority_tier_max, is_tenant_root } = buildVisibilityFilter({
    tenantId,
    bindings,
    tree,
    ...(activeBindingId === undefined ? {} : { activeBindingId }),
  });

  const orgUnitIds = filter.org_unit_ids;

  // Distinguish "scope kind" by the user's DIRECTLY bound units
  // (ignoring descendant expansion). One direct binding = org_unit
  // scope (even if it expands to many descendant ids).
  const activeBindings = bindings.filter((b) => b.revoked_at === null);
  const selected =
    activeBindingId === undefined
      ? activeBindings
      : activeBindings.filter((b) => b.id === activeBindingId);
  const directlyBoundUnitIds = new Set<string>();
  for (const b of selected) {
    if (b.scope_kind !== 'tenant_root' && b.org_unit_id !== null) {
      directlyBoundUnitIds.add(b.org_unit_id);
    }
  }

  const kind: ResolvedScopeKind = is_tenant_root
    ? 'tenant_root'
    : directlyBoundUnitIds.size <= 1
      ? 'org_unit'
      : 'multi_org_unit';

  // Determine the "primary" path for terminology resolution. When
  // tenant_root, no path. When a single org_unit, that unit's path.
  // When multi_org_unit, no single path — terminology falls back to
  // tenant-level overrides only.
  let scopePath: string | null = null;
  if (kind === 'org_unit' && directlyBoundUnitIds.size === 1) {
    const onlyId = [...directlyBoundUnitIds][0];
    if (onlyId !== undefined) {
      const unit = tree.byId.get(onlyId);
      if (unit !== undefined) {
        scopePath = unit.materialised_path;
      }
    }
  }

  const resolvedTerminology = resolveTerminologyForScope({
    tenantId,
    scopePath,
    tree,
    overrides: terminologyOverrides,
  });

  const visibleRecipes = filterByScope(publishedRecipes ?? [], orgUnitIds, is_tenant_root)
    .map((r) => r.recipe_id);
  const visibleJuniors = filterByScope(publishedJuniors ?? [], orgUnitIds, is_tenant_root)
    .map((j) => j.junior_id);

  const legacyMode = tree.byId.size === 0;

  return {
    kind,
    tenant_id: tenantId,
    org_unit_ids: orgUnitIds,
    authority_tier_max,
    visible_tables_filter: filter,
    visible_juniors: Object.freeze([...visibleJuniors].sort()),
    visible_recipes: Object.freeze([...visibleRecipes].sort()),
    resolved_terminology: resolvedTerminology,
    legacy_mode: legacyMode,
  };
}

interface ScopedRow {
  readonly org_unit_id: string | null;
}

function filterByScope<T extends ScopedRow>(
  rows: ReadonlyArray<T>,
  orgUnitIds: ReadonlyArray<string>,
  isTenantRoot: boolean,
): ReadonlyArray<T> {
  if (isTenantRoot) {
    return rows;
  }
  const allowed = new Set(orgUnitIds);
  return rows.filter((row) => row.org_unit_id === null || allowed.has(row.org_unit_id));
}
