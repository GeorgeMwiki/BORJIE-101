/**
 * AuthorityLevel — orthogonal chain-of-command tier attribute.
 *
 * NOT an RBAC role — see `packages/authz-policy/src/system-roles.ts`.
 * This is an orthogonal tier attribute that layers on top of the existing 8
 * RBAC system roles. RBAC answers "what can this person do?" (resource/action
 * permissions). AuthorityLevel answers "how high up the chain of command are
 * they?" (approval routing, escalation, override authority).
 *
 * Lower `tier` = higher authority. Non-contiguous spacing (0, 1, 10, 20, ...)
 * leaves room for future in-between tiers without renumbering.
 *
 * See `Docs/analysis/CONFLICT_RESOLUTIONS.md` — "Conflict 1 — Admin L1-L4
 * Hierarchy" for the full design rationale.
 */

/**
 * NOTE on the `SystemRole` mirror below:
 *
 * The source of truth for the 8 RBAC system roles lives in
 * `packages/authz-policy/src/system-roles.ts`. We cannot import from
 * `@borjie/authz-policy` here because `authz-policy` already depends on
 * `@borjie/domain-models` — doing so would create a circular dependency.
 *
 * Instead we mirror the string literal values. The mirror is kept in lock-step
 * with `system-roles.ts` by the `DEFAULT_AUTHORITY_FOR_ROLE` exhaustiveness
 * test in `authority-level.test.ts`, which asserts the full set of expected
 * SystemRole string values — failing loudly if the two files drift apart.
 */
const SystemRoleValues = {
  SUPER_ADMIN: 'super_admin',
  PLATFORM_SUPPORT: 'platform_support',
  TENANT_ADMIN: 'tenant_admin',
  PROPERTY_MANAGER: 'property_manager',
  OWNER: 'owner',
  ESTATE_MANAGER: 'estate_manager',
  ACCOUNTANT: 'accountant',
  CUSTOMER: 'customer',
  VIEWER: 'viewer',
} as const;

type SystemRole = (typeof SystemRoleValues)[keyof typeof SystemRoleValues];

/** Shape of each authority-level entry. */
export interface AuthorityLevelDescriptor {
  /** Lower = higher authority. */
  readonly tier: number;
  /**
   * Soft cap on how many principals in a single org may hold this level.
   * `null` means no cap. Enforced at `UserRoleAssignment` write time by a
   * guard that reads `org.settings.superAdminCap` (default 2 for SUPER_ADMIN).
   */
  readonly maxPerOrg: number | null;
  /**
   * Only authority levels with `canDeleteOrg: true` may call `org.delete()`.
   * Super admins are rejected with `INSUFFICIENT_AUTHORITY`.
   */
  readonly canDeleteOrg: boolean;
}

/**
 * The ordered chain of authority from voice-memo spec:
 *   Owner > Super Admin (<=2 per org) > Admin L1-L4 > Estate Manager
 *   > Station Master (tagged worker) > Other Workers (tagged)
 *
 * Lower `tier` = higher authority.
 */
export const AuthorityLevel = {
  OWNER: { tier: 0, maxPerOrg: null, canDeleteOrg: true },
  SUPER_ADMIN: { tier: 1, maxPerOrg: 2, canDeleteOrg: false },
  ADMIN_L1: { tier: 10, maxPerOrg: null, canDeleteOrg: false },
  ADMIN_L2: { tier: 20, maxPerOrg: null, canDeleteOrg: false },
  ADMIN_L3: { tier: 30, maxPerOrg: null, canDeleteOrg: false },
  ADMIN_L4: { tier: 40, maxPerOrg: null, canDeleteOrg: false },
  ESTATE_MANAGER: { tier: 50, maxPerOrg: null, canDeleteOrg: false },
  STATION_MASTER: { tier: 60, maxPerOrg: null, canDeleteOrg: false },
  WORKER: { tier: 70, maxPerOrg: null, canDeleteOrg: false },
} as const satisfies Record<string, AuthorityLevelDescriptor>;

/** Union of valid authority-level identifiers. */
export type AuthorityLevelId = keyof typeof AuthorityLevel;

/**
 * Default AuthorityLevel for each RBAC SystemRole.
 *
 * Used as a backfill when `UserRoleAssignment.authorityLevel` is absent on
 * legacy rows or legacy JWT tokens ("derive from role" fallback).
 */
export const DEFAULT_AUTHORITY_FOR_ROLE: Record<SystemRole, AuthorityLevelId> = {
  [SystemRoleValues.SUPER_ADMIN]: 'SUPER_ADMIN',
  [SystemRoleValues.PLATFORM_SUPPORT]: 'ADMIN_L4',
  [SystemRoleValues.TENANT_ADMIN]: 'ADMIN_L1',
  [SystemRoleValues.PROPERTY_MANAGER]: 'ADMIN_L3',
  [SystemRoleValues.OWNER]: 'OWNER',
  [SystemRoleValues.ESTATE_MANAGER]: 'ESTATE_MANAGER',
  [SystemRoleValues.ACCOUNTANT]: 'ADMIN_L3',
  [SystemRoleValues.CUSTOMER]: 'WORKER',
  [SystemRoleValues.VIEWER]: 'WORKER',
};

/**
 * Worker tag — routes workflows to a specific user based on skill/role scope.
 *
 * Example: a tag with `key: "station-master"`, `teamScope: "geo-node"` is
 * discoverable by the workflow router when an application is filed within
 * that geo-node.
 */
export interface WorkerTag {
  /** Machine identifier, e.g. "station-master", "surveyor", "plumber". */
  readonly key: string;
  /** Human-readable label. */
  readonly label: string;
  /** Scope of the team this tag belongs to. */
  readonly teamScope: 'org' | 'geo-node' | 'property';
  /** ID of the scoped entity (geo-node or property). Absent for org-scope. */
  readonly teamScopeId?: string;
}

/**
 * Compare two authority levels by tier.
 *
 * Returns:
 * - negative number if `a` is HIGHER authority than `b` (lower tier number)
 * - positive number if `a` is LOWER authority than `b` (higher tier number)
 * - `0` if equal
 *
 * Matches the `Array.prototype.sort` comparator convention, so sorting an
 * array of ids ascending by this function yields highest-authority first.
 */
export function compareAuthority(a: AuthorityLevelId, b: AuthorityLevelId): number {
  return AuthorityLevel[a].tier - AuthorityLevel[b].tier;
}

/**
 * Minimal subject shape consumed by `hasAuthorityAtLeast`.
 *
 * Intentionally structural so this helper works with the full `User`
 * entity, a resolved `UserWithRoles`, or any JWT-derived claim bag that
 * carries an authority level.
 */
export interface AuthoritySubject {
  readonly authorityLevel?: AuthorityLevelId | undefined;
}

/**
 * Check whether a subject holds authority at or above the given tier.
 *
 * "At or above" means `subject.tier <= requiredTier` (lower tier = higher
 * authority). A subject with no `authorityLevel` set is treated as the
 * lowest tier and always fails this check.
 */
export function hasAuthorityAtLeast(
  subject: AuthoritySubject,
  requiredTier: number
): boolean {
  if (!subject.authorityLevel) {
    return false;
  }
  return AuthorityLevel[subject.authorityLevel].tier <= requiredTier;
}
