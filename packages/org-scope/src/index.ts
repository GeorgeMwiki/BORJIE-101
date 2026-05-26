/**
 * `@borjie/org-scope` — public surface (Wave 18X).
 *
 * Org Hierarchy + Terminology foundation:
 *
 *   types/            value-types + Zod schemas
 *   hierarchy/        org-unit tree builder + ancestor/descendant resolvers
 *                     + materialised-path utilities
 *   scope/            user-scope resolver + visibility filter + authority checker
 *   terminology/      40+ default catalogue + per-tenant overrides + resolver
 *   bindings/         user-scope binding repository port + multi-binding picker
 *   md-factory/       ScopedOrgUserDataContext builder for the multi-level MD
 *   audit/            hash-chained audit entry builder for scope mutations
 *
 * Implements `docs/DESIGN/ORG_HIERARCHY_TERMINOLOGY_SPEC.md`.
 */

// ── Types ────────────────────────────────────────────────────────────
export type {
  AuthorityTier,
  OrgRole,
  OrgUnit,
  OrgUnitKind,
  ResolvedScope,
  ResolvedScopeKind,
  ResolvedTerminology,
  ResolvedTerminologyEntry,
  ScopeKind,
  TerminologyCategory,
  TerminologyDefault,
  TerminologyOverride,
  UserScopeBinding,
  VisibilityFilter,
} from './types.js';
export {
  AUTHORITY_TIERS,
  AuthorityTierSchema,
  ORG_ROLES,
  OrgRoleSchema,
  ORG_UNIT_KINDS,
  OrgUnitKindSchema,
  OrgUnitSchema,
  RESOLVED_SCOPE_KINDS,
  SCOPE_KINDS,
  ScopeKindSchema,
  TERMINOLOGY_CATEGORIES,
  TerminologyCategorySchema,
  TerminologyDefaultSchema,
  TerminologyOverrideSchema,
  UserScopeBindingSchema,
} from './types.js';

// ── Hierarchy ────────────────────────────────────────────────────────
export {
  buildChildPath,
  buildTenantRootPath,
  isDescendantPath,
  slugify,
} from './hierarchy/path-builder.js';
export {
  buildOrgUnitTree,
  TreeBuildError,
  type BuildTreeInput,
  type OrgUnitTree,
} from './hierarchy/org-unit-tree-builder.js';
export {
  isAncestor,
  isSelfOrAncestor,
  resolveAncestors,
} from './hierarchy/ancestor-resolver.js';
export {
  resolveDescendants,
  resolveSelfAndDescendants,
} from './hierarchy/descendant-resolver.js';

// ── Scope ────────────────────────────────────────────────────────────
export {
  buildVisibilityFilter,
  type BuildVisibilityFilterInput,
  type BuildVisibilityFilterResult,
} from './scope/visibility-filter.js';
export {
  checkAuthority,
  type AuthorityVerdict,
  type AuthorityVerdictReason,
  type CheckAuthorityInput,
} from './scope/authority-checker.js';
export {
  resolveUserScope,
  type ResolveUserScopeInput,
} from './scope/resolve-user-scope.js';

// ── Terminology ──────────────────────────────────────────────────────
export {
  DEFAULT_TERMINOLOGY,
  DEFAULT_TERMINOLOGY_BY_KEY,
} from './terminology/defaults.js';
export {
  resolveTerminologyForScope,
  term,
  type ResolveTerminologyInput,
} from './terminology/resolver.js';
export {
  InMemoryTerminologyOverrideRepository,
  type ListOverridesQuery,
  type TerminologyOverrideRepository,
  type UpsertOverrideInput,
} from './terminology/override-repository.js';

// ── Bindings ─────────────────────────────────────────────────────────
export {
  InMemoryUserScopeBindingRepository,
  type GrantBindingInput,
  type ListBindingsQuery,
  type UserScopeBindingRepository,
} from './bindings/binding-repository.js';
export {
  pickActiveBinding,
  type PickBindingInput,
  type PickBindingResult,
} from './bindings/multi-binding-resolver.js';

// ── MD factory ───────────────────────────────────────────────────────
export {
  buildScopedMDContext,
  ROOT_PERSONA,
  type BuildScopedMDContextInput,
  type PersonaIdentity,
  type ScopedOrgUserDataContext,
} from './md-factory/scoped-md-factory.js';

// ── Audit ────────────────────────────────────────────────────────────
export {
  buildOrgScopeAuditEntry,
  type OrgScopeAuditEntry,
  type OrgScopeAuditEventInput,
  type OrgScopeAuditEventKind,
} from './audit/audit-emit.js';
