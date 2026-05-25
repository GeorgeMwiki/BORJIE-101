/**
 * Role-gate — auth-injected principal → DisclosureTier resolver.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §6
 */

export {
  type PrincipalRole,
  type AuthInjectedPrincipal,
  type RoleGateResult,
} from './types.js';
export {
  ROLE_TIER_MAP,
  getDisclosureTierForPrincipal,
  getDisclosureTierWithReason,
  rejectUserSuppliedRoleHeaders,
  isKnownRole,
} from './role-gate.js';
