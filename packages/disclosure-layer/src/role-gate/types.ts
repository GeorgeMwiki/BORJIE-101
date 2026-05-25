/**
 * Role-gate types — auth-injected principal-role → DisclosureTier mapping.
 *
 * CRITICAL CONTRACT: `principal.role` MUST be sourced from the auth
 * middleware (e.g. K-A SessionStore / AM-1 cookie auth). It is NEVER
 * read from a user-supplied request body or header.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §6
 */

/**
 * Canonical role identifiers. These map 1:1 to the auth middleware's
 * RBAC roles (see @borjie/authz-policy SystemRoles).
 *
 * Numeric-vs-string mapping deliberately not exported; consumers must
 * pass the canonical string and never construct a Principal manually.
 */
export type PrincipalRole =
  // External (tier-1 SAFE only)
  | 'tenant-customer'
  | 'property-owner'
  | 'applicant'
  | 'unauthenticated'
  // Internal (tier-2 HIGH_RISK)
  | 'internal-cs-agent'
  | 'platform-admin'
  | 'internal-engineer'
  // Security (tier-3 NEVER — read-only via audit endpoint)
  | 'security-engineer';

/**
 * The auth-injected principal handed to the disclosure layer.
 *
 * `role` here is the *source-of-truth* role injected by the auth
 * middleware. Anything that arrived in user-supplied body/headers
 * MUST have been stripped before this object was constructed.
 */
export interface AuthInjectedPrincipal {
  /** Opaque principal identifier (e.g. usr_xxx). */
  readonly id: string;
  /** Role sourced from the auth gateway, NEVER from user input. */
  readonly role: PrincipalRole;
  /** Optional tenant scope. */
  readonly tenantId?: string;
  /** Marker proving the role came from the auth middleware. */
  readonly source: 'auth-middleware';
}

/**
 * Result of a role-gate evaluation.
 */
export interface RoleGateResult {
  readonly principalId: string;
  readonly role: PrincipalRole;
  readonly tier: import('../tier-taxonomy/types.js').DisclosureTier;
  readonly reason: string;
}
