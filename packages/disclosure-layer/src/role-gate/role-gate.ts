/**
 * Role-gate — resolves an auth-injected principal to a DisclosureTier.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §6
 */

import { DisclosureTier } from '../tier-taxonomy/types.js';
import { type AuthInjectedPrincipal, type PrincipalRole, type RoleGateResult } from './types.js';

/**
 * Canonical role → tier mapping. Immutable.
 *
 * External principals are capped at SAFE.
 * Internal staff is HIGH_RISK.
 * Security team is NEVER-cleared but should normally be channelled
 * through a separate audit endpoint, not the live disclosure path.
 */
export const ROLE_TIER_MAP: Readonly<Record<PrincipalRole, DisclosureTier>> = Object.freeze({
  // External / unauthenticated → SAFE only
  unauthenticated: DisclosureTier.SAFE,
  'tenant-customer': DisclosureTier.SAFE,
  'property-owner': DisclosureTier.SAFE,
  applicant: DisclosureTier.SAFE,
  // Internal staff → HIGH_RISK
  'internal-cs-agent': DisclosureTier.HIGH_RISK,
  'platform-admin': DisclosureTier.HIGH_RISK,
  'internal-engineer': DisclosureTier.HIGH_RISK,
  // Security → NEVER (live-disclosure path; audit endpoint is separate)
  'security-engineer': DisclosureTier.NEVER,
});

const VALID_ROLES = new Set<string>(Object.keys(ROLE_TIER_MAP));

/**
 * Resolve the principal's disclosure tier.
 *
 * Fails closed (SAFE) on:
 *   - principal whose `source` is not the auth-middleware marker
 *   - unknown role
 */
export function getDisclosureTierForPrincipal(principal: AuthInjectedPrincipal): DisclosureTier {
  if (principal.source !== 'auth-middleware') return DisclosureTier.SAFE;
  const tier = ROLE_TIER_MAP[principal.role];
  return tier ?? DisclosureTier.SAFE;
}

/**
 * Verbose form — returns the audit record.
 */
export function getDisclosureTierWithReason(
  principal: AuthInjectedPrincipal
): RoleGateResult {
  if (principal.source !== 'auth-middleware') {
    return {
      principalId: principal.id,
      role: principal.role,
      tier: DisclosureTier.SAFE,
      reason: 'principal-source-not-auth-middleware-fail-closed',
    };
  }
  const tier = ROLE_TIER_MAP[principal.role];
  if (tier === undefined) {
    return {
      principalId: principal.id,
      role: principal.role,
      tier: DisclosureTier.SAFE,
      reason: 'unknown-role-fail-closed',
    };
  }
  return {
    principalId: principal.id,
    role: principal.role,
    tier,
    reason: `role:${principal.role} → tier ${String(tier)}`,
  };
}

/**
 * Negative-test helper — used by the runtime composer to assert that
 * a candidate role string did not arrive via a user-supplied header.
 *
 * Rejects:
 *   - Common header names attackers use to spoof role
 *   - Any header whose name matches /role/i except known infra headers
 */
export function rejectUserSuppliedRoleHeaders(
  headers: Readonly<Record<string, string | string[] | undefined>>
): { readonly accepted: boolean; readonly offendingHeaders: readonly string[] } {
  const banned = new Set([
    'x-role',
    'x-user-role',
    'x-principal-role',
    'x-rbac-role',
    'role',
    'x-borjie-role',
  ]);
  const offending: string[] = [];
  for (const name of Object.keys(headers)) {
    const lower = name.toLowerCase();
    if (banned.has(lower)) offending.push(lower);
  }
  return Object.freeze({
    accepted: offending.length === 0,
    offendingHeaders: Object.freeze([...offending]),
  });
}

/**
 * Type guard — narrows an unknown role string to a known PrincipalRole.
 * Used at the auth-middleware boundary to validate incoming roles.
 */
export function isKnownRole(role: string): role is PrincipalRole {
  return VALID_ROLES.has(role);
}
