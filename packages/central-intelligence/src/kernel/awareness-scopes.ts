/**
 * Awareness scopes — tier-scoped visibility bubbles. The binary
 * tenant/platform discriminator on ScopeContext is the security
 * boundary; tiers are richer reasoning lenses INSIDE the tenant scope.
 *
 * A request at tier=lease can talk about that lease and its parent
 * unit/block/property in summary form, but cannot see sibling leases
 * by id. A request at tier=portfolio can roll up across an owner's
 * properties but not name another owner.
 *
 * The kernel uses the tier to:
 *   1. Pick which cohort signals are k-anonymous-safe to mix in
 *   2. Bias which tools the registry exposes
 *   3. Frame the system prompt's locus of identity
 *
 * Tiers form a strict containment lattice; `contains(parent, child)` is
 * the single primitive other modules consume.
 */

import type { AwarenessTier } from './kernel-types.js';
import type { ScopeContext } from '../types.js';

const ORDER: ReadonlyArray<AwarenessTier> = [
  'tenant',
  'lease',
  'unit',
  'block',
  'property',
  'portfolio',
  'org',
  'industry',
];

const RANK: Readonly<Record<AwarenessTier, number>> = Object.freeze(
  Object.fromEntries(ORDER.map((t, i) => [t, i])) as Record<AwarenessTier, number>,
);

export function tierRank(tier: AwarenessTier): number {
  return RANK[tier];
}

/** Does `parent` strictly contain (or equal) `child`? */
export function contains(parent: AwarenessTier, child: AwarenessTier): boolean {
  return RANK[parent] >= RANK[child];
}

/** Smallest tier that contains both. */
export function commonAncestor(a: AwarenessTier, b: AwarenessTier): AwarenessTier {
  return RANK[a] >= RANK[b] ? a : b;
}

/**
 * The platform scope can ONLY operate at tier=industry. A request that
 * names tenant/lease/unit while in platform scope is invalid and the
 * kernel must refuse it.
 */
export function isTierCompatibleWithScope(
  tier: AwarenessTier,
  scope: ScopeContext,
): { ok: true } | { ok: false; reason: string } {
  if (scope.kind === 'platform' && tier !== 'industry') {
    return {
      ok: false,
      reason: `platform scope can only think at tier=industry; got tier=${tier}`,
    };
  }
  if (scope.kind === 'tenant' && tier === 'industry') {
    return {
      ok: false,
      reason: 'tenant scope cannot reach industry tier; route through platform HQ',
    };
  }
  return { ok: true };
}

/**
 * The locus phrase rendered into the system prompt — what the assistant
 * IS in this tier.
 */
export function locusPhrase(tier: AwarenessTier, scope: ScopeContext): string {
  if (scope.kind === 'platform') return 'the property-management industry, observing itself';
  switch (tier) {
    case 'tenant':    return 'this resident\'s personal concierge inside the estate';
    case 'lease':     return 'this lease, in conversation with its signatories';
    case 'unit':      return 'this unit, summarising its leases over time';
    case 'block':     return 'this block of units';
    case 'property':  return 'this property, summarising every block';
    case 'portfolio': return 'this owner\'s portfolio of properties';
    case 'org':       return 'this estate-management organisation in full';
    case 'industry':  return 'the platform-wide aggregate';
  }
}

/**
 * The minimum k for k-anonymous cohort signals at this tier. Lower
 * tiers see only fully-aggregated peers; the platform tier requires
 * the strongest k.
 */
export function cohortMinK(tier: AwarenessTier): number {
  switch (tier) {
    case 'tenant':
    case 'lease':     return 5;
    case 'unit':
    case 'block':     return 7;
    case 'property':  return 10;
    case 'portfolio': return 15;
    case 'org':       return 20;
    case 'industry':  return 25;
  }
}

// ──────────────────────────────────────────────────────────────────
// D9 / G5 — Role × Tier composition.
// ──────────────────────────────────────────────────────────────────

export type AwarenessRole =
  | 'resident'
  | 'manager'
  | 'owner'
  | 'admin'
  | 'sovereign-admin'
  | 'platform-operator';

const ROLE_RANK: Readonly<Record<AwarenessRole, number>> = Object.freeze({
  resident: 0,
  manager: 1,
  owner: 2,
  admin: 3,
  'sovereign-admin': 4,
  'platform-operator': 5,
});

export function roleRank(role: AwarenessRole): number {
  return ROLE_RANK[role];
}

const ALLOWED_ROLE_TIER: Readonly<
  Record<AwarenessRole, ReadonlyArray<AwarenessTier>>
> = Object.freeze({
  resident: ['tenant', 'lease'],
  manager: ['unit', 'block', 'property', 'portfolio'],
  owner: ['property', 'portfolio'],
  admin: ['property', 'portfolio', 'org'],
  'sovereign-admin': ['org'],
  'platform-operator': ['industry'],
});

export interface RoleScope {
  readonly role: AwarenessRole;
  readonly tier: AwarenessTier;
  readonly minK: number;
  readonly requiresPseudonymisation: boolean;
}

export interface RoleScopeError {
  readonly ok: false;
  readonly reason: string;
}

export function composeScope(
  role: AwarenessRole,
  tier: AwarenessTier,
): RoleScope | RoleScopeError {
  const allowed = ALLOWED_ROLE_TIER[role];
  if (!allowed.includes(tier)) {
    return {
      ok: false,
      reason: `role "${role}" cannot operate at tier "${tier}"; allowed tiers: ${allowed.join(', ')}`,
    };
  }
  const baseK = cohortMinK(tier);
  const roleBoost =
    role === 'platform-operator'
      ? 15
      : role === 'sovereign-admin'
        ? 10
        : role === 'admin'
          ? 5
          : 0;
  const minK = Math.max(baseK, baseK + roleBoost);
  const requiresPseudonymisation =
    role === 'platform-operator' ||
    role === 'admin' ||
    role === 'sovereign-admin' ||
    tier === 'org' ||
    tier === 'industry';
  return { role, tier, minK, requiresPseudonymisation };
}

export function isRoleScope(value: RoleScope | RoleScopeError): value is RoleScope {
  return (value as RoleScopeError).ok !== false;
}
