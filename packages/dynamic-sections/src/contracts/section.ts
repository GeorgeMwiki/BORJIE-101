/**
 * Section registry contract — Phase J3.
 *
 * The vision: BORJIE's owner-portal and admin-web must
 * NOT pre-render a tab for every conceivable entity type. A new tenant
 * starts empty; tabs appear as the MD's entity types come into being
 * (typically via chat-driven kernel actions). When a tenant has zero
 * KRA filings the "Filings" tab is absent. The instant the first one
 * lands, the tab materialises — because the section's
 * `visibility_predicate` flips true.
 *
 * Every Section in the registry declares:
 *   - identity (`key`, `label`, `icon`, `entity_type`)
 *   - a `visibility_predicate` (sum type — see VisibilityPredicate)
 *   - a `component_loader` that returns a dynamic import
 *   - a `sort_order` for stable tab ordering
 *
 * The portals never reach across this contract — they consume the
 * filtered + lazy-loaded sections from `useSectionRegistry()`.
 */

import type { ComponentType } from 'react';

/**
 * Scope determines which sections are eligible for inclusion before
 * any predicate evaluation. The two scopes mirror the two
 * non-customer-app portals: internal-admin (admin-web,
 * platform staff) and owner-customer (owner-portal, the MD's tenants).
 *
 * A Section may declare which scopes it belongs to via `scopes`. If
 * `scopes` is omitted the Section is visible in both.
 */
export type SectionScope = 'internal-admin' | 'owner-customer';

/**
 * The component module returned by a Section's loader. Mirrors the
 * shape of a default-export React module produced by Next.js dynamic
 * imports (`() => import('./Foo')`).
 */
export interface ComponentModule {
  readonly default: ComponentType<SectionComponentProps>;
}

/**
 * Props handed to every Section component. Kept intentionally narrow.
 * Sections that need richer context should read from React Query or
 * route state — never via props injection.
 */
export interface SectionComponentProps {
  readonly tenantId: string;
  readonly orgId?: string | undefined;
  readonly entityType: string;
  readonly scope: SectionScope;
  /**
   * Optional consumer-supplied localised title override for the
   * section heading (i18n). When omitted, the seed section components
   * fall back to their English defaults.
   */
  readonly localisedTitle?: string;
  /**
   * Optional consumer-supplied localised description override (i18n).
   */
  readonly localisedDescription?: string;
}

/**
 * VisibilityPredicate — sum type evaluated against a {@link SectionContext}.
 *
 * Four leaf predicates + two combinators ('and' / 'or'). Negation is
 * deliberately omitted — callers compose `or` against an explicit
 * `has-entities` of zero to express "absence". This keeps the type
 * trivially serialisable and trivially auditable.
 */
export type VisibilityPredicate =
  | HasEntitiesPredicate
  | RoleAllowedPredicate
  | FeatureFlagPredicate
  | AndPredicate
  | OrPredicate;

/**
 * True when the tenant has >0 entities of `entity_type`. This is the
 * primary driver of the "tabs appear when data exists" rule — the
 * MD's chat-driven entity creation flips this predicate true on first
 * write.
 */
export interface HasEntitiesPredicate {
  readonly kind: 'has-entities';
  readonly entity_type: string;
}

/**
 * True when the viewer holds any of the named roles.
 */
export interface RoleAllowedPredicate {
  readonly kind: 'role-allowed';
  readonly roles: readonly string[];
}

/**
 * True when the named feature-flag is enabled for the current
 * tenant. Wired to the same flag service the rest of BORJIE uses.
 */
export interface FeatureFlagPredicate {
  readonly kind: 'feature-flag';
  readonly flag: string;
}

/**
 * Logical AND — all sub-predicates must be true. Empty `preds`
 * arrays evaluate true (vacuous truth) so an `and` with no children
 * never hides a section.
 */
export interface AndPredicate {
  readonly kind: 'and';
  readonly preds: readonly VisibilityPredicate[];
}

/**
 * Logical OR — any sub-predicate may be true. Empty `preds` arrays
 * evaluate false (a section guarded by an empty `or` is always hidden).
 */
export interface OrPredicate {
  readonly kind: 'or';
  readonly preds: readonly VisibilityPredicate[];
}

/**
 * The context against which a VisibilityPredicate is evaluated.
 * Injected once per render of `useSectionRegistry()`.
 */
export interface SectionContext {
  readonly tenantId: string;
  readonly orgId?: string | undefined;
  readonly scope: SectionScope;
  /** Map of entity_type → count. Absent keys are treated as zero. */
  readonly entityCounts: Readonly<Record<string, number>>;
  /** Roles the current viewer holds. */
  readonly roles: readonly string[];
  /** Feature flags enabled for the current tenant. */
  readonly featureFlags: readonly string[];
}

/**
 * A Section descriptor — the unit of registration in the dynamic
 * registry. The portals never instantiate sections directly; they
 * call `useSectionRegistry()` which filters by predicate + scope.
 */
export interface Section {
  /** Stable identifier used for URL slugs, query keys, and React keys. */
  readonly key: string;
  /** Human-readable tab label. */
  readonly label: string;
  /**
   * Lucide-react icon name. Stored as a string so registries are
   * serialisable + we don't bundle every icon up front.
   */
  readonly icon: string;
  /**
   * The entity type this section is centred on. Used both for the
   * default `has-entities` predicate and for query-key prefixing.
   */
  readonly entity_type: string;
  /** Predicate that decides whether this section is visible. */
  readonly visibility_predicate: VisibilityPredicate;
  /**
   * Dynamic-import factory. Returns the module containing the
   * default-exported React component. Mobile lazy-load lives here.
   */
  readonly component_loader: () => Promise<ComponentModule>;
  /** Lower sort_order = further-left tab. */
  readonly sort_order: number;
  /**
   * Scopes this section is eligible for. Omitted = visible in both
   * `internal-admin` and `owner-customer`.
   */
  readonly scopes?: readonly SectionScope[];
  /**
   * Optional badge metadata — surfaced in the tab when present. The
   * registry doesn't decide the badge value; the section component
   * fetches its own count and uses an out-of-band hook to publish.
   */
  readonly badge?: SectionBadge;
}

export interface SectionBadge {
  readonly kind: 'count' | 'dot' | 'text';
  readonly maxLength?: number;
}
