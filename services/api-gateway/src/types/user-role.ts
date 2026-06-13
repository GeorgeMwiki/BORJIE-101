/**
 * User Role Enum for API Gateway
 * Simplified role types for mock data and authentication
 */

export const UserRole = {
  // Platform Admin Roles (BORJIE Internal)
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  SUPPORT: 'SUPPORT',

  // Tenant Admin Roles
  TENANT_ADMIN: 'TENANT_ADMIN',
  /**
   * @deprecated property-era — retained as the enum slot that the mining
   * `site_manager`/`manager`/`property_manager` Supabase roles map onto
   * (see auth/supabase/supabase-auth-middleware.ts). Still referenced by the
   * authorization matrix, capability-gate, rate-limiter, and several mining
   * routers, so it CANNOT be removed without a coordinated role rename. Treat
   * it as the mining "site manager" role until that rename lands.
   */
  PROPERTY_MANAGER: 'PROPERTY_MANAGER',
  ACCOUNTANT: 'ACCOUNTANT',
  /**
   * @deprecated property-era — retained as the enum slot that the mining
   * `maintenance`/`driver`/field-employee Supabase roles map onto. Still
   * referenced by the authorization matrix, capability-gate, rate-limiter,
   * and the mining drill-holes/fuel-logs routers, so it CANNOT be removed
   * without a coordinated role rename. Treat it as the mining "field worker"
   * role until that rename lands.
   */
  MAINTENANCE_STAFF: 'MAINTENANCE_STAFF',

  // External User Roles
  OWNER: 'OWNER',
  /**
   * @deprecated property-era — retained as the enum slot that the Borjie
   * marketplace `buyer` and `resident` Supabase roles map onto (see
   * auth/supabase/supabase-auth-middleware.ts and buyer/superpowers.hono.ts).
   * Still referenced by the authorization matrix, capability-gate, and
   * rate-limiter, so it CANNOT be removed without a coordinated role rename.
   * Treat it as the mining "buyer / read-only external" role until then.
   */
  RESIDENT: 'RESIDENT',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

/**
 * Check if a role is a platform-level admin role
 */
export function isPlatformAdmin(role: UserRole): boolean {
  return (
    role === UserRole.SUPER_ADMIN ||
    role === UserRole.ADMIN ||
    role === UserRole.SUPPORT
  );
}

/**
 * Check if a role is a tenant admin role
 */
export function isTenantAdmin(role: UserRole): boolean {
  return role === UserRole.TENANT_ADMIN || role === UserRole.SUPER_ADMIN;
}

/**
 * Get human-readable role name.
 *
 * NOTE: the enum KEYS (`PROPERTY_MANAGER`, `MAINTENANCE_STAFF`, `RESIDENT`) are
 * property-era slots retained until the coordinated role rename (INT-5) lands —
 * see the per-key @deprecated notes above. The user-FACING labels below,
 * however, are the mining-native terms, so nothing a user reads says
 * "Property Manager" / "Maintenance Staff" / "Resident".
 */
export function getRoleName(role: UserRole): string {
  const names: Record<UserRole, string> = {
    SUPER_ADMIN: 'Super Admin',
    ADMIN: 'Admin',
    SUPPORT: 'Support',
    TENANT_ADMIN: 'Tenant Admin',
    PROPERTY_MANAGER: 'Site Manager',
    ACCOUNTANT: 'Accountant',
    MAINTENANCE_STAFF: 'Field Worker',
    OWNER: 'Owner',
    RESIDENT: 'Buyer',
  };
  return names[role] || role;
}
