/**
 * Org Scope — type surface (Wave 18X).
 *
 * Companion to docs/DESIGN/ORG_HIERARCHY_TERMINOLOGY_SPEC.md. All
 * public types live here so the rest of the package — and downstream
 * sibling-package retrofits — import a single canonical surface.
 *
 * Everything in this module is value-types only (no side effects, no
 * I/O). Behavioural code lives under hierarchy/, scope/, terminology/,
 * bindings/, md-factory/, audit/.
 */

import { z } from 'zod';

// =============================================================================
// Org Unit
// =============================================================================

/**
 * Default unit-kinds shipped by the platform. Tenants override the
 * *display* names via `display_kind_singular` / `display_kind_plural`
 * (and via the per-org-unit terminology override row keyed on
 * `org_unit`). The `default_kind` enum value never changes — it is the
 * stable contract used by RBAC, recipes, and reports.
 */
export const ORG_UNIT_KINDS = [
  'district',
  'branch',
  'division',
  'department',
  'unit',
  'team',
  'crew',
  'ward',
  'company',
  'region',
  'zone',
  'subsidiary',
] as const;

export type OrgUnitKind = (typeof ORG_UNIT_KINDS)[number];

export const OrgUnitKindSchema = z.enum(ORG_UNIT_KINDS);

export interface OrgUnit {
  readonly id: string;
  readonly tenant_id: string;
  readonly parent_unit_id: string | null;
  readonly default_kind: OrgUnitKind;
  readonly display_name: string;
  readonly display_kind_singular: string;
  readonly display_kind_plural: string;
  readonly materialised_path: string;
  readonly depth: number;
  readonly authority_inheritance: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export const OrgUnitSchema: z.ZodType<OrgUnit> = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().min(1),
  parent_unit_id: z.string().uuid().nullable(),
  default_kind: OrgUnitKindSchema,
  display_name: z.string().min(1),
  display_kind_singular: z.string().min(1),
  display_kind_plural: z.string().min(1),
  materialised_path: z.string().min(1),
  depth: z.number().int().nonnegative(),
  authority_inheritance: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

// =============================================================================
// Roles + authority tier
// =============================================================================

export const ORG_ROLES = [
  'owner',
  'admin',
  'manager',
  'employee',
  'customer',
  'auditor',
] as const;

export type OrgRole = (typeof ORG_ROLES)[number];

export const OrgRoleSchema = z.enum(ORG_ROLES);

export const AUTHORITY_TIERS = [0, 1, 2] as const;
export type AuthorityTier = (typeof AUTHORITY_TIERS)[number];
export const AuthorityTierSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);

// =============================================================================
// User-scope binding
// =============================================================================

export const SCOPE_KINDS = ['tenant_root', 'org_unit', 'cross_scope'] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];
export const ScopeKindSchema = z.enum(SCOPE_KINDS);

export interface UserScopeBinding {
  readonly id: string;
  readonly user_id: string;
  readonly tenant_id: string;
  readonly scope_kind: ScopeKind;
  readonly org_unit_id: string | null;
  readonly role: OrgRole;
  readonly authority_tier_max: AuthorityTier;
  readonly granted_at: string;
  readonly granted_by: string;
  readonly revoked_at: string | null;
}

export const UserScopeBindingSchema: z.ZodType<UserScopeBinding> = z.object({
  id: z.string().uuid(),
  user_id: z.string().min(1),
  tenant_id: z.string().min(1),
  scope_kind: ScopeKindSchema,
  org_unit_id: z.string().uuid().nullable(),
  role: OrgRoleSchema,
  authority_tier_max: AuthorityTierSchema,
  granted_at: z.string(),
  granted_by: z.string().min(1),
  revoked_at: z.string().nullable(),
});

// =============================================================================
// Resolved scope (the runtime context every MD turn receives)
// =============================================================================

export const RESOLVED_SCOPE_KINDS = [
  'tenant_root',
  'org_unit',
  'multi_org_unit',
] as const;

export type ResolvedScopeKind = (typeof RESOLVED_SCOPE_KINDS)[number];

/**
 * The compact filter description applied to every data query that
 * crosses a scope boundary. The shape is interpreted by repositories
 * — `tenant_id` is always set; `org_unit_ids` is empty iff the scope
 * is `tenant_root` (which means "no extra filter beyond tenant").
 */
export interface VisibilityFilter {
  readonly tenant_id: string;
  readonly org_unit_ids: ReadonlyArray<string>;
  readonly include_descendants: boolean;
}

export interface ResolvedTerminologyEntry {
  readonly key: string;
  readonly singular_en: string;
  readonly plural_en: string;
  readonly singular_sw: string;
  readonly plural_sw: string;
  /** Where this row came from — defaults, tenant-wide override, or scoped override. */
  readonly source: 'default' | 'tenant' | 'org_unit' | 'ancestor';
}

export interface ResolvedTerminology {
  readonly tenant_id: string;
  readonly scope_path: string | null;
  readonly entries: ReadonlyMap<string, ResolvedTerminologyEntry>;
}

export interface ResolvedScope {
  readonly kind: ResolvedScopeKind;
  readonly tenant_id: string;
  readonly org_unit_ids: ReadonlyArray<string>;
  readonly authority_tier_max: AuthorityTier;
  readonly visible_tables_filter: VisibilityFilter;
  readonly visible_juniors: ReadonlyArray<string>;
  readonly visible_recipes: ReadonlyArray<string>;
  readonly resolved_terminology: ResolvedTerminology;
  /**
   * When a tenant has not configured org units, sub-org MDs collapse
   * to the tenant-root MD. Sibling packages can short-circuit any
   * scope-aware logic when this flag is true.
   */
  readonly legacy_mode: boolean;
}

// =============================================================================
// Terminology defaults + overrides
// =============================================================================

export const TERMINOLOGY_CATEGORIES = [
  'org_structure',
  'people',
  'asset',
  'process',
  'compliance',
  'commerce',
] as const;

export type TerminologyCategory = (typeof TERMINOLOGY_CATEGORIES)[number];
export const TerminologyCategorySchema = z.enum(TERMINOLOGY_CATEGORIES);

export interface TerminologyDefault {
  readonly key: string;
  readonly singular_en: string;
  readonly plural_en: string;
  readonly singular_sw: string;
  readonly plural_sw: string;
  readonly category: TerminologyCategory;
  readonly description: string;
}

export const TerminologyDefaultSchema: z.ZodType<TerminologyDefault> = z.object({
  key: z.string().min(1),
  singular_en: z.string().min(1),
  plural_en: z.string().min(1),
  singular_sw: z.string().min(1),
  plural_sw: z.string().min(1),
  category: TerminologyCategorySchema,
  description: z.string().min(1),
});

export interface TerminologyOverride {
  readonly id: string;
  readonly tenant_id: string;
  readonly org_unit_id: string | null;
  readonly key: string;
  readonly singular_en: string;
  readonly plural_en: string;
  readonly singular_sw: string | null;
  readonly plural_sw: string | null;
  readonly overridden_by: string;
  readonly overridden_at: string;
}

export const TerminologyOverrideSchema: z.ZodType<TerminologyOverride> = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().min(1),
  org_unit_id: z.string().uuid().nullable(),
  key: z.string().min(1),
  singular_en: z.string().min(1),
  plural_en: z.string().min(1),
  singular_sw: z.string().nullable(),
  plural_sw: z.string().nullable(),
  overridden_by: z.string().min(1),
  overridden_at: z.string(),
});
