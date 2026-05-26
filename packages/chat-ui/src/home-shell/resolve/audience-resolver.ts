/**
 * audience-resolver — maps (role, surface) -> ResolvedAgent.
 *
 * This is the bridge between HomeShell and the agent-platform
 * junior-contract module (forthcoming in 18V). Today the resolver is
 * a static lookup table; once 18V lands, this module will wrap
 * `resolveAgentForUser` from `@borjie/agent-platform`.
 *
 * Per the persona routing table in HOME_DASHBOARD_STANDARD §3:
 *   - owner / admin / public → Mr. Mwikila (full MD)
 *   - site_manager → Mr. Mwikila for cross-domain, scoped junior for in-domain
 *   - worker → safety / comms / shift junior
 *   - buyer → marketplace / KYB junior
 *
 * The resolver is deliberately renderer-pure — no I/O, no side
 * effects. Tests pin the mapping.
 */

import type { HomeShellUserRole, ResolvedAgent } from '../types.js';

export interface ResolveAudienceInput {
  readonly user_role: HomeShellUserRole;
  readonly surface: ResolvedAgent['surface'];
  readonly persona_override?: string | undefined;
}

const MR_MWIKILA_FULL: Omit<ResolvedAgent, 'surface'> = {
  id: 'mr-mwikila-full',
  display_name: 'Mr. Mwikila',
  title: 'Managing Director',
};

const MR_MWIKILA_PUBLIC: Omit<ResolvedAgent, 'surface'> = {
  id: 'mr-mwikila-public',
  display_name: 'Mr. Mwikila',
  title: 'Borjie AI',
};

const SAFETY_JUNIOR: Omit<ResolvedAgent, 'surface'> = {
  id: 'safety-junior',
  display_name: 'Safety Officer',
  title: 'Workforce Junior',
};

const MARKETPLACE_JUNIOR: Omit<ResolvedAgent, 'surface'> = {
  id: 'marketplace-junior',
  display_name: 'Marketplace Concierge',
  title: 'Buyer Junior',
};

const ESTATE_OPS_JUNIOR: Omit<ResolvedAgent, 'surface'> = {
  id: 'estate-ops-junior',
  display_name: 'Estate Operations',
  title: 'Site Junior',
};

const TENANT_JUNIOR: Omit<ResolvedAgent, 'surface'> = {
  id: 'tenant-junior',
  display_name: 'Tenancy Concierge',
  title: 'Customer Junior',
};

/**
 * Resolves the persona for HomeShell. Pure function, no I/O.
 *
 * Override precedence:
 *   1. persona_override (deep-link target wins)
 *   2. role + surface mapping
 */
export function resolveAudience(input: ResolveAudienceInput): ResolvedAgent {
  const { user_role, surface, persona_override } = input;

  if (persona_override) {
    return {
      id: persona_override,
      display_name: 'Mr. Mwikila',
      title: 'Managing Director',
      surface,
    };
  }

  if (user_role === 'owner' || user_role === 'admin') {
    return { ...MR_MWIKILA_FULL, surface };
  }

  if (user_role === 'public') {
    return { ...MR_MWIKILA_PUBLIC, surface };
  }

  if (user_role === 'worker') {
    return { ...SAFETY_JUNIOR, surface };
  }

  if (user_role === 'buyer') {
    return { ...MARKETPLACE_JUNIOR, surface };
  }

  if (user_role === 'site_manager') {
    if (
      surface === 'bossnyumba-estate-manager-app' ||
      surface === 'bossnyumba-customer-app' ||
      surface === 'bossnyumba-tenant-portal'
    ) {
      return { ...ESTATE_OPS_JUNIOR, surface };
    }
    return { ...MR_MWIKILA_FULL, surface };
  }

  if (
    surface === 'bossnyumba-customer-app' ||
    surface === 'bossnyumba-tenant-portal'
  ) {
    return { ...TENANT_JUNIOR, surface };
  }

  // Defensive fallback — should never hit if types are honoured.
  return { ...MR_MWIKILA_FULL, surface };
}

/**
 * Default surface mapping for a role when the host app does not
 * override. Used by HomeShell to derive surface from role.
 */
export function defaultSurfaceForRole(
  role: HomeShellUserRole,
): ResolvedAgent['surface'] {
  if (role === 'owner') return 'owner-web';
  if (role === 'admin') return 'admin-web';
  if (role === 'public') return 'marketing';
  if (role === 'worker' || role === 'site_manager') return 'workforce-mobile';
  if (role === 'buyer') return 'buyer-mobile';
  return 'owner-web';
}
