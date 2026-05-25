/**
 * Role Domain Model
 * 
 * Roles define collections of permissions that can be assigned to users.
 * BORJIE uses a hybrid RBAC+ABAC model where roles provide base permissions
 * and policies can further refine access based on attributes.
 */

import type {
  TenantId,
  RoleId,
  UserId,
  EntityMetadata,
  SoftDeletable,
  TenantScoped,
} from '../common/types.js';

/** Role type classification */
export const RoleType = {
  /** Built-in system role (cannot be modified or deleted) */
  SYSTEM: 'SYSTEM',
  /** Tenant-level custom role */
  CUSTOM: 'CUSTOM',
} as const;

export type RoleType = (typeof RoleType)[keyof typeof RoleType];

/** Role scope determines where the role can be assigned */
export const RoleScope = {
  /** Can be assigned at any organization level */
  GLOBAL: 'GLOBAL',
  /** Can only be assigned at root organization */
  ROOT_ONLY: 'ROOT_ONLY',
  /** Can only be assigned at property-level organizations */
  PROPERTY_ONLY: 'PROPERTY_ONLY',
} as const;

export type RoleScope = (typeof RoleScope)[keyof typeof RoleScope];

/** Permission resource categories */
export const ResourceCategory = {
  TENANT: 'tenant',
  ORGANIZATION: 'organization',
  USER: 'user',
  ROLE: 'role',
  PROPERTY: 'property',
  UNIT: 'unit',
  LEASE: 'lease',
  CUSTOMER: 'customer',
  MAINTENANCE: 'maintenance',
  WORK_ORDER: 'work_order',
  PAYMENT: 'payment',
  INVOICE: 'invoice',
  DOCUMENT: 'document',
  REPORT: 'report',
  NOTIFICATION: 'notification',
  AUDIT: 'audit',
  SETTINGS: 'settings',
} as const;

export type ResourceCategory = (typeof ResourceCategory)[keyof typeof ResourceCategory];

/** Permission actions */
export const PermissionAction = {
  CREATE: 'create',
  READ: 'read',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  EXPORT: 'export',
  APPROVE: 'approve',
  ASSIGN: 'assign',
  MANAGE: 'manage',
} as const;

export type PermissionAction = (typeof PermissionAction)[keyof typeof PermissionAction];

/** 
 * Permission definition
 * Format: resource:action or resource:action:constraint
 * Examples: 
 *   - "user:read" - can read any user
 *   - "user:read:own" - can only read own user
 *   - "property:manage" - full management of properties
 */
export interface Permission {
  readonly resource: ResourceCategory;
  readonly action: PermissionAction;
  /** Optional constraint for ABAC evaluation */
  readonly constraint: string | null;
}

/** Parse a permission string into a Permission object */
export function parsePermission(permString: string): Permission | null {
  const parts = permString.split(':');
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }
  
  const [resource, action, constraint] = parts;
  
  if (!Object.values(ResourceCategory).includes(resource as ResourceCategory)) {
    return null;
  }
  if (!Object.values(PermissionAction).includes(action as PermissionAction)) {
    return null;
  }
  
  return {
    resource: resource as ResourceCategory,
    action: action as PermissionAction,
    constraint: constraint ?? null,
  };
}

/** Format a Permission object to string */
export function formatPermission(permission: Permission): string {
  const base = `${permission.resource}:${permission.action}`;
  return permission.constraint ? `${base}:${permission.constraint}` : base;
}

/** Core Role entity */
export interface Role extends EntityMetadata, SoftDeletable, TenantScoped {
  readonly id: RoleId;
  /** Role name (unique within tenant) */
  readonly name: string;
  /** Human-readable description */
  readonly description: string;
  /** Role type (system or custom) */
  readonly type: RoleType;
  /** Role scope (where it can be assigned) */
  readonly scope: RoleScope;
  /** List of permission strings */
  readonly permissions: readonly string[];
  /** Whether this role grants admin privileges */
  readonly isAdmin: boolean;
  /** Priority for conflict resolution (higher wins) */
  readonly priority: number;
  /** Roles that this role inherits from */
  readonly inheritsFrom: readonly RoleId[];
}

/** Input for creating a custom role */
export interface CreateRoleInput {
  readonly name: string;
  readonly description: string;
  readonly scope: RoleScope;
  readonly permissions: readonly string[];
  readonly isAdmin?: boolean;
  readonly priority?: number;
  readonly inheritsFrom?: readonly RoleId[];
}

/** Input for updating a role */
export interface UpdateRoleInput {
  readonly name?: string;
  readonly description?: string;
  readonly permissions?: readonly string[];
  readonly isAdmin?: boolean;
  readonly priority?: number;
  readonly inheritsFrom?: readonly RoleId[];
}

/** Role with computed effective permissions (including inherited) */
export interface RoleWithEffectivePermissions extends Role {
  readonly effectivePermissions: readonly string[];
}

/** Built-in system role names */
export const SystemRoleName = {
  /** Super admin with all permissions */
  SUPER_ADMIN: 'super_admin',
  /** Tenant administrator */
  TENANT_ADMIN: 'tenant_admin',
  /** Property owner with full property access */
  PROPERTY_OWNER: 'property_owner',
  /** Estate manager with operational access */
  ESTATE_MANAGER: 'estate_manager',
  /** Customer with limited self-service access */
  CUSTOMER: 'customer',
  /** Read-only auditor */
  AUDITOR: 'auditor',
  /** Finance manager for payments and reports */
  FINANCE_MANAGER: 'finance_manager',
  /** Support agent with customer service access */
  SUPPORT_AGENT: 'support_agent',
} as const;

export type SystemRoleName = (typeof SystemRoleName)[keyof typeof SystemRoleName];

/** System role definitions (seeded on tenant creation) */
export const SYSTEM_ROLES: Record<SystemRoleName, Omit<Role, 'id' | 'tenantId' | keyof EntityMetadata | keyof SoftDeletable>> = {
  super_admin: {
    name: 'Super Admin',
    description: 'Full system access with all permissions',
    type: RoleType.SYSTEM,
    scope: RoleScope.ROOT_ONLY,
    permissions: ['*:*'], // Wildcard for all permissions
    isAdmin: true,
    priority: 1000,
    inheritsFrom: [],
  },
  tenant_admin: {
    name: 'Tenant Admin',
    description: 'Tenant-level administrative access',
    type: RoleType.SYSTEM,
    scope: RoleScope.ROOT_ONLY,
    permissions: [
      'organization:*',
      'user:*',
      'role:*',
      'property:*',
      'settings:*',
      'report:*',
      'audit:read',
      'audit:list',
      'audit:export',
    ],
    isAdmin: true,
    priority: 900,
    inheritsFrom: [],
  },
  property_owner: {
    name: 'Property Owner',
    description: 'Property owner with portfolio management access',
    type: RoleType.SYSTEM,
    scope: RoleScope.GLOBAL,
    permissions: [
      'property:read',
      'property:list',
      'unit:read',
      'unit:list',
      'lease:read',
      'lease:list',
      'customer:read',
      'customer:list',
      'maintenance:read',
      'maintenance:list',
      'maintenance:approve',
      'work_order:read',
      'work_order:list',
      'payment:read',
      'payment:list',
      'invoice:read',
      'invoice:list',
      'document:read',
      'document:list',
      'report:read',
      'report:export',
      'notification:*',
    ],
    isAdmin: false,
    priority: 500,
    inheritsFrom: [],
  },
  estate_manager: {
    name: 'Estate Manager',
    description: 'Property manager with operational access',
    type: RoleType.SYSTEM,
    scope: RoleScope.PROPERTY_ONLY,
    permissions: [
      'property:read',
      'unit:read',
      'unit:update',
      'unit:list',
      'lease:*',
      'customer:*',
      'maintenance:*',
      'work_order:*',
      'document:create',
      'document:read',
      'document:list',
      'notification:*',
    ],
    isAdmin: false,
    priority: 400,
    inheritsFrom: [],
  },
  customer: {
    name: 'Customer',
    description: 'Tenant/customer with self-service access',
    type: RoleType.SYSTEM,
    scope: RoleScope.PROPERTY_ONLY,
    permissions: [
      'lease:read:own',
      'payment:create:own',
      'payment:read:own',
      'payment:list:own',
      'maintenance:create:own',
      'maintenance:read:own',
      'maintenance:list:own',
      'document:read:own',
      'document:list:own',
      'notification:read:own',
      'notification:list:own',
      'user:read:own',
      'user:update:own',
    ],
    isAdmin: false,
    priority: 100,
    inheritsFrom: [],
  },
  auditor: {
    name: 'Auditor',
    description: 'Read-only access for compliance and auditing',
    type: RoleType.SYSTEM,
    scope: RoleScope.GLOBAL,
    permissions: [
      'organization:read',
      'organization:list',
      'user:read',
      'user:list',
      'role:read',
      'role:list',
      'property:read',
      'property:list',
      'unit:read',
      'unit:list',
      'lease:read',
      'lease:list',
      'customer:read',
      'customer:list',
      'maintenance:read',
      'maintenance:list',
      'work_order:read',
      'work_order:list',
      'payment:read',
      'payment:list',
      'invoice:read',
      'invoice:list',
      'document:read',
      'document:list',
      'report:read',
      'report:export',
      'audit:read',
      'audit:list',
      'audit:export',
    ],
    isAdmin: false,
    priority: 300,
    inheritsFrom: [],
  },
  finance_manager: {
    name: 'Finance Manager',
    description: 'Financial operations and reporting access',
    type: RoleType.SYSTEM,
    scope: RoleScope.GLOBAL,
    permissions: [
      'payment:*',
      'invoice:*',
      'report:*',
      'customer:read',
      'customer:list',
      'lease:read',
      'lease:list',
      'property:read',
      'property:list',
      'audit:read',
      'audit:list',
    ],
    isAdmin: false,
    priority: 450,
    inheritsFrom: [],
  },
  support_agent: {
    name: 'Support Agent',
    description: 'Customer support access',
    type: RoleType.SYSTEM,
    scope: RoleScope.GLOBAL,
    permissions: [
      'customer:read',
      'customer:list',
      'maintenance:read',
      'maintenance:list',
      'maintenance:update',
      'work_order:read',
      'work_order:list',
      'work_order:update',
      'notification:*',
      'document:read',
      'document:list',
    ],
    isAdmin: false,
    priority: 200,
    inheritsFrom: [],
  },
};

/** Check if a role is a system role (cannot be modified) */
export function isSystemRole(role: Role): boolean {
  return role.type === RoleType.SYSTEM;
}

/** Check if a permission string matches another (supports wildcards) */
export function permissionMatches(permission: string, required: string): boolean {
  // Exact match
  if (permission === required) {
    return true;
  }
  
  // Wildcard all
  if (permission === '*:*') {
    return true;
  }
  
  const [permResource, permAction] = permission.split(':');
  const [reqResource, reqAction] = required.split(':');
  
  // Resource wildcard
  if (permAction === '*' && permResource === reqResource) {
    return true;
  }
  
  return false;
}

/** Check if a role has a specific permission */
export function roleHasPermission(role: Role, required: string): boolean {
  return role.permissions.some((perm) => permissionMatches(perm, required));
}
