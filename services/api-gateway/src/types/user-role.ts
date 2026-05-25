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
  PROPERTY_MANAGER: 'PROPERTY_MANAGER',
  ACCOUNTANT: 'ACCOUNTANT',
  MAINTENANCE_STAFF: 'MAINTENANCE_STAFF',

  // External User Roles
  OWNER: 'OWNER',
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
 * Get human-readable role name
 */
export function getRoleName(role: UserRole): string {
  const names: Record<UserRole, string> = {
    SUPER_ADMIN: 'Super Admin',
    ADMIN: 'Admin',
    SUPPORT: 'Support',
    TENANT_ADMIN: 'Tenant Admin',
    PROPERTY_MANAGER: 'Property Manager',
    ACCOUNTANT: 'Accountant',
    MAINTENANCE_STAFF: 'Maintenance Staff',
    OWNER: 'Owner',
    RESIDENT: 'Resident',
  };
  return names[role] || role;
}
