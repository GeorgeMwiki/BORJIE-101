/**
 * Authority checker (Wave 18X §7 + §8).
 *
 * Given a user's effective tier ceiling and the desired action tier,
 * answer: "is this user allowed to perform a Tier-N action in this
 * scope?"
 *
 * Returns a small structured verdict rather than a bare boolean so the
 * caller can surface a precise rejection reason in the UI and the
 * audit chain.
 */

import type { AuthorityTier, OrgRole } from '../types.js';

export type AuthorityVerdictReason =
  | 'allowed'
  | 'no_binding'
  | 'tier_exceeded'
  | 'role_blocked'
  | 'scope_mismatch';

export interface AuthorityVerdict {
  readonly allowed: boolean;
  readonly reason: AuthorityVerdictReason;
  readonly required_tier: AuthorityTier;
  readonly user_tier: AuthorityTier;
}

/** Roles that may never exceed Tier 0 (read-only) regardless of binding. */
const READ_ONLY_ROLES: ReadonlySet<OrgRole> = new Set<OrgRole>(['auditor']);

/** Roles that may exercise Tier 2 (hard mutations) when bound at the right scope. */
const TIER_2_CAPABLE_ROLES: ReadonlySet<OrgRole> = new Set<OrgRole>(['owner', 'admin']);

export interface CheckAuthorityInput {
  readonly user_tier: AuthorityTier;
  readonly required_tier: AuthorityTier;
  readonly role: OrgRole;
  /**
   * Whether the action targets a record inside the user's resolved
   * scope. Pass `false` when the API has already detected a scope
   * mismatch (e.g. a sub-org admin POSTing to another org_unit).
   */
  readonly in_scope: boolean;
}

export function checkAuthority(input: CheckAuthorityInput): AuthorityVerdict {
  const { user_tier, required_tier, role, in_scope } = input;
  if (!in_scope) {
    return {
      allowed: false,
      reason: 'scope_mismatch',
      required_tier,
      user_tier,
    };
  }
  if (READ_ONLY_ROLES.has(role) && required_tier > 0) {
    return {
      allowed: false,
      reason: 'role_blocked',
      required_tier,
      user_tier,
    };
  }
  if (required_tier === 2 && !TIER_2_CAPABLE_ROLES.has(role)) {
    return {
      allowed: false,
      reason: 'role_blocked',
      required_tier,
      user_tier,
    };
  }
  if (user_tier < required_tier) {
    return {
      allowed: false,
      reason: 'tier_exceeded',
      required_tier,
      user_tier,
    };
  }
  return {
    allowed: true,
    reason: 'allowed',
    required_tier,
    user_tier,
  };
}
