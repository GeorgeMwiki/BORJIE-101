/**
 * System-defined roles and their default permissions.
 *
 * These roles are created automatically for every tenant and cannot be deleted.
 */

import { Policy, Action, Resource, PolicyPermission } from './types.js';

// ============================================================================
// System Role Identifiers
// ============================================================================

export const SystemRoles = {
  // Platform-level roles (BORJIE internal)
  SUPER_ADMIN: 'super_admin',
  PLATFORM_SUPPORT: 'platform_support',

  // Tenant-level roles
  TENANT_ADMIN: 'tenant_admin',
  PROPERTY_MANAGER: 'property_manager',
  OWNER: 'owner',
  ESTATE_MANAGER: 'estate_manager',
  /**
   * Station Master (NEW 18) — first-line operator covering a geographic
   * or tag-based slice of the portfolio. Similar in scope to an Estate
   * Manager, but bounded by a routing coverage definition.
   */
  STATION_MASTER: 'station_master',
  ACCOUNTANT: 'accountant',
  CUSTOMER: 'customer',
  VIEWER: 'viewer',
} as const;

export type SystemRole = (typeof SystemRoles)[keyof typeof SystemRoles];

// ============================================================================
// Role Identity Helpers (Piece P)
// ============================================================================

/**
 * Canonical set of admin-tier roles. A role name (any casing) is
 * "admin" if it normalises to one of these.
 *
 * Use `isAdminRole(roleName)` instead of `role === 'admin'` everywhere
 * in business logic — this is the one place the platform decides what
 * counts as an admin role.
 */
const ADMIN_ROLE_NAMES: ReadonlySet<string> = new Set([
  SystemRoles.SUPER_ADMIN,
  SystemRoles.TENANT_ADMIN,
  'admin',
  'administrator',
]);

/**
 * Test whether a role name represents an admin-tier role. Casing- and
 * underscore-tolerant: `'ADMIN'`, `'Admin'`, `'TENANT_ADMIN'`,
 * `'tenant_admin'`, `'super-admin'`, `'super admin'` all return true.
 */
export function isAdminRole(roleName: string | null | undefined): boolean {
  if (!roleName) return false;
  const normalised = roleName.trim().toLowerCase().replace(/[\s-]/g, '_');
  return ADMIN_ROLE_NAMES.has(normalised);
}

// ============================================================================
// Permission Helpers
// ============================================================================

const ALL_ACTIONS: Action[] = ['create', 'read', 'update', 'delete', 'manage', 'approve'];
const CRUD_ACTIONS: Action[] = ['create', 'read', 'update', 'delete'];
const READ_ONLY: Action[] = ['read'];

function createPermission(
  resource: Resource,
  actions: Action[],
  conditions?: PolicyPermission['conditions']
): PolicyPermission {
  return { resource, actions, conditions };
}

function fullAccess(resource: Resource): PolicyPermission {
  return createPermission(resource, ALL_ACTIONS);
}

function crudAccess(resource: Resource): PolicyPermission {
  return createPermission(resource, CRUD_ACTIONS);
}

function readOnly(resource: Resource): PolicyPermission {
  return createPermission(resource, READ_ONLY);
}

// ============================================================================
// System Policies
// ============================================================================

/**
 * Tenant Administrator - Full access to all tenant resources.
 */
export const TenantAdminPolicy: Policy = {
  id: 'policy:tenant_admin',
  name: 'Tenant Administrator',
  description: 'Full administrative access to all tenant resources',
  effect: 'allow',
  priority: 100,
  permissions: [
    fullAccess('user'),
    fullAccess('role'),
    fullAccess('property'),
    fullAccess('unit'),
    fullAccess('owner_account'),
    fullAccess('customer_account'),
    fullAccess('lease'),
    fullAccess('occupancy'),
    fullAccess('payment'),
    fullAccess('invoice'),
    fullAccess('disbursement'),
    fullAccess('work_order'),
    fullAccess('vendor'),
    fullAccess('document'),
    fullAccess('report'),
    fullAccess('settings'),
    readOnly('audit_log'),
  ],
};

/**
 * Property Manager - Manages properties and operational activities.
 */
export const PropertyManagerPolicy: Policy = {
  id: 'policy:property_manager',
  name: 'Property Manager',
  description: 'Manage properties, units, leases, and maintenance',
  effect: 'allow',
  priority: 80,
  permissions: [
    readOnly('user'),
    crudAccess('property'),
    crudAccess('unit'),
    readOnly('owner_account'),
    crudAccess('customer_account'),
    crudAccess('lease'),
    crudAccess('occupancy'),
    readOnly('payment'),
    crudAccess('invoice'),
    readOnly('disbursement'),
    crudAccess('work_order'),
    crudAccess('vendor'),
    crudAccess('document'),
    readOnly('report'),
  ],
};

/**
 * Owner - Property owner with visibility into their investments.
 */
export const OwnerPolicy: Policy = {
  id: 'policy:owner',
  name: 'Property Owner',
  description: 'View portfolio performance and approve disbursements',
  effect: 'allow',
  priority: 70,
  permissions: [
    // Owners can only see their own properties (enforced by conditions in runtime)
    createPermission('property', READ_ONLY),
    createPermission('unit', READ_ONLY),
    createPermission('owner_account', ['read', 'update']),
    createPermission('lease', READ_ONLY),
    createPermission('occupancy', READ_ONLY),
    createPermission('payment', READ_ONLY),
    createPermission('invoice', READ_ONLY),
    createPermission('disbursement', ['read', 'approve']),
    createPermission('work_order', ['read', 'approve']),
    createPermission('document', READ_ONLY),
    createPermission('report', READ_ONLY),
  ],
};

/**
 * Estate Manager - Field operations and day-to-day property management.
 */
export const EstateManagerPolicy: Policy = {
  id: 'policy:estate_manager',
  name: 'Estate Manager',
  description: 'Handle field operations, work orders, and inspections',
  effect: 'allow',
  priority: 60,
  permissions: [
    readOnly('property'),
    readOnly('unit'),
    readOnly('customer_account'),
    readOnly('lease'),
    crudAccess('occupancy'),
    readOnly('payment'),
    crudAccess('work_order'),
    readOnly('vendor'),
    createPermission('document', ['create', 'read']),
  ],
};

/**
 * Station Master (NEW 18) - First-line operator for a coverage area.
 * Scope mirrors Estate Manager but is constrained to the coverage
 * definition recorded in station_master_coverage (enforced at runtime).
 */
export const StationMasterPolicy: Policy = {
  id: 'policy:station_master',
  name: 'Station Master',
  description:
    'First-line handling of applications, work orders, and resident issues for a coverage area',
  effect: 'allow',
  priority: 55,
  permissions: [
    readOnly('property'),
    readOnly('unit'),
    readOnly('customer_account'),
    readOnly('lease'),
    crudAccess('occupancy'),
    readOnly('payment'),
    crudAccess('work_order'),
    readOnly('vendor'),
    createPermission('document', ['create', 'read']),
  ],
};

/**
 * Accountant - Financial management and reporting.
 */
export const AccountantPolicy: Policy = {
  id: 'policy:accountant',
  name: 'Accountant',
  description: 'Manage payments, invoices, and financial reports',
  effect: 'allow',
  priority: 60,
  permissions: [
    readOnly('property'),
    readOnly('unit'),
    readOnly('owner_account'),
    readOnly('customer_account'),
    readOnly('lease'),
    crudAccess('payment'),
    crudAccess('invoice'),
    crudAccess('disbursement'),
    readOnly('work_order'),
    crudAccess('document'),
    fullAccess('report'),
  ],
};

/**
 * Customer - Tenant/buyer with self-service capabilities.
 */
export const CustomerPolicy: Policy = {
  id: 'policy:customer',
  name: 'Customer',
  description: 'Self-service access to own lease, payments, and maintenance',
  effect: 'allow',
  priority: 50,
  permissions: [
    // Customers can only access their own data (enforced at runtime)
    createPermission('customer_account', ['read', 'update']),
    createPermission('lease', READ_ONLY),
    createPermission('occupancy', READ_ONLY),
    createPermission('payment', ['create', 'read']),
    createPermission('invoice', READ_ONLY),
    createPermission('work_order', ['create', 'read']),
    createPermission('document', READ_ONLY),
  ],
};

/**
 * Viewer - Read-only access for observers.
 */
export const ViewerPolicy: Policy = {
  id: 'policy:viewer',
  name: 'Viewer',
  description: 'Read-only access to view data without modifications',
  effect: 'allow',
  priority: 10,
  permissions: [
    readOnly('property'),
    readOnly('unit'),
    readOnly('lease'),
    readOnly('occupancy'),
    readOnly('payment'),
    readOnly('invoice'),
    readOnly('work_order'),
    readOnly('report'),
  ],
};

// ============================================================================
// Policy Registry
// ============================================================================

/**
 * All system-defined policies.
 */
export const SystemPolicies: Policy[] = [
  TenantAdminPolicy,
  PropertyManagerPolicy,
  OwnerPolicy,
  EstateManagerPolicy,
  StationMasterPolicy,
  AccountantPolicy,
  CustomerPolicy,
  ViewerPolicy,
];

/**
 * Map of role ID to policy.
 */
export const RolePolicyMap: Record<SystemRole, Policy> = {
  [SystemRoles.SUPER_ADMIN]: TenantAdminPolicy, // Super admin inherits tenant admin
  [SystemRoles.PLATFORM_SUPPORT]: ViewerPolicy, // Platform support has read-only
  [SystemRoles.TENANT_ADMIN]: TenantAdminPolicy,
  [SystemRoles.PROPERTY_MANAGER]: PropertyManagerPolicy,
  [SystemRoles.OWNER]: OwnerPolicy,
  [SystemRoles.ESTATE_MANAGER]: EstateManagerPolicy,
  [SystemRoles.STATION_MASTER]: StationMasterPolicy,
  [SystemRoles.ACCOUNTANT]: AccountantPolicy,
  [SystemRoles.CUSTOMER]: CustomerPolicy,
  [SystemRoles.VIEWER]: ViewerPolicy,
};

/**
 * Get policy for a given role.
 */
export function getPolicyForRole(role: string): Policy | undefined {
  return RolePolicyMap[role as SystemRole];
}

/**
 * Get policies for a list of roles.
 */
export function getPoliciesForRoles(roles: string[]): Policy[] {
  return roles.map((role) => getPolicyForRole(role)).filter((p): p is Policy => p !== undefined);
}
