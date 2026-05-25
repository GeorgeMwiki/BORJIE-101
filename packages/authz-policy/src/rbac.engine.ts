export type Action = 'create' | 'read' | 'update' | 'delete' | 'manage' | 'list' | string;
export type Resource = 'property' | 'unit' | 'tenant' | 'lease' | 'payment' | 'invoice' | 'maintenance' | 'report' | 'user' | 'role' | string;

export interface Permission {
  action: Action;
  resource: Resource;
  conditions?: Record<string, unknown>;
}

export interface Role {
  name: string;
  description?: string;
  permissions: Permission[];
  inherits?: string[];
}

export interface User {
  id: string;
  roles: string[];
  tenantId?: string;
  propertyIds?: string[];
}

export interface RbacConfig {
  roles: Record<string, Role>;
  defaultDenyAll?: boolean;
}

// Default role definitions for property management
const defaultRoles: Record<string, Role> = {
  'super-admin': {
    name: 'super-admin',
    description: 'Full system access',
    permissions: [{ action: 'manage', resource: '*' }],
  },
  'property-owner': {
    name: 'property-owner',
    description: 'Property owner with full access to their properties',
    permissions: [
      { action: 'manage', resource: 'property' },
      { action: 'manage', resource: 'unit' },
      { action: 'manage', resource: 'tenant' },
      { action: 'manage', resource: 'lease' },
      { action: 'manage', resource: 'payment' },
      { action: 'manage', resource: 'invoice' },
      { action: 'manage', resource: 'maintenance' },
      { action: 'read', resource: 'report' },
    ],
  },
  'property-manager': {
    name: 'property-manager',
    description: 'Manages properties on behalf of owner',
    permissions: [
      { action: 'read', resource: 'property' },
      { action: 'update', resource: 'property' },
      { action: 'manage', resource: 'unit' },
      { action: 'manage', resource: 'tenant' },
      { action: 'manage', resource: 'lease' },
      { action: 'manage', resource: 'payment' },
      { action: 'manage', resource: 'invoice' },
      { action: 'manage', resource: 'maintenance' },
      { action: 'read', resource: 'report' },
    ],
    inherits: ['caretaker'],
  },
  caretaker: {
    name: 'caretaker',
    description: 'On-site property caretaker',
    permissions: [
      { action: 'read', resource: 'property' },
      { action: 'read', resource: 'unit' },
      { action: 'read', resource: 'tenant' },
      { action: 'create', resource: 'maintenance' },
      { action: 'read', resource: 'maintenance' },
      { action: 'update', resource: 'maintenance' },
    ],
  },
  tenant: {
    name: 'tenant',
    description: 'Property tenant',
    permissions: [
      { action: 'read', resource: 'lease', conditions: { ownLease: true } },
      { action: 'read', resource: 'payment', conditions: { ownPayments: true } },
      { action: 'read', resource: 'invoice', conditions: { ownInvoices: true } },
      { action: 'create', resource: 'maintenance' },
      { action: 'read', resource: 'maintenance', conditions: { ownRequests: true } },
    ],
  },
  accountant: {
    name: 'accountant',
    description: 'Financial access only',
    permissions: [
      { action: 'read', resource: 'payment' },
      { action: 'create', resource: 'payment' },
      { action: 'read', resource: 'invoice' },
      { action: 'manage', resource: 'invoice' },
      { action: 'read', resource: 'report' },
    ],
  },
};

export class RbacEngine {
  private roles: Record<string, Role>;
  private defaultDenyAll: boolean;

  constructor(config: Partial<RbacConfig> = {}) {
    this.roles = { ...defaultRoles, ...config.roles };
    this.defaultDenyAll = config.defaultDenyAll ?? true;
  }

  /**
   * Register a new role
   */
  registerRole(role: Role): void {
    this.roles[role.name] = role;
  }

  /**
   * Get all permissions for a role, including inherited ones
   */
  getRolePermissions(roleName: string, visited: Set<string> = new Set()): Permission[] {
    if (visited.has(roleName)) return []; // Prevent circular inheritance
    visited.add(roleName);

    const role = this.roles[roleName];
    if (!role) return [];

    let permissions = [...role.permissions];

    // Add inherited permissions
    if (role.inherits) {
      for (const inheritedRole of role.inherits) {
        permissions = [...permissions, ...this.getRolePermissions(inheritedRole, visited)];
      }
    }

    return permissions;
  }

  /**
   * Get all permissions for a user based on their roles
   */
  getUserPermissions(user: User): Permission[] {
    const permissions: Permission[] = [];

    for (const roleName of user.roles) {
      permissions.push(...this.getRolePermissions(roleName));
    }

    return permissions;
  }

  /**
   * Check if an action matches (handles wildcards)
   */
  private actionMatches(permissionAction: Action, requestedAction: Action): boolean {
    if (permissionAction === 'manage' || permissionAction === '*') return true;
    return permissionAction === requestedAction;
  }

  /**
   * Check if a resource matches (handles wildcards)
   */
  private resourceMatches(permissionResource: Resource, requestedResource: Resource): boolean {
    if (permissionResource === '*') return true;
    return permissionResource === requestedResource;
  }

  /**
   * Check if user has permission to perform action on resource
   */
  checkPermission(
    user: User,
    action: Action,
    resource: Resource,
    context?: Record<string, unknown>
  ): { allowed: boolean; matchedPermission?: Permission; reason?: string } {
    const permissions = this.getUserPermissions(user);

    for (const permission of permissions) {
      if (this.actionMatches(permission.action, action) && this.resourceMatches(permission.resource, resource)) {
        // Check conditions if present
        if (permission.conditions && context) {
          const conditionsMet = this.evaluateConditions(permission.conditions, context, user);
          if (!conditionsMet) continue;
        }

        return {
          allowed: true,
          matchedPermission: permission,
        };
      }
    }

    return {
      allowed: false,
      reason: `User ${user.id} does not have permission to ${action} ${resource}`,
    };
  }

  /**
   * Evaluate permission conditions
   */
  private evaluateConditions(
    conditions: Record<string, unknown>,
    context: Record<string, unknown>,
    user: User
  ): boolean {
    for (const [key, value] of Object.entries(conditions)) {
      switch (key) {
        case 'ownLease':
        case 'ownPayments':
        case 'ownInvoices':
        case 'ownRequests':
          if (value === true && context.userId !== user.id) {
            return false;
          }
          break;
        case 'sameProperty':
          if (value === true && user.propertyIds && !user.propertyIds.includes(context.propertyId as string)) {
            return false;
          }
          break;
        case 'sameTenant':
          if (value === true && user.tenantId !== context.tenantId) {
            return false;
          }
          break;
        default:
          // Generic condition check
          if (context[key] !== value) {
            return false;
          }
      }
    }
    return true;
  }

  /**
   * Check multiple permissions at once
   */
  checkPermissions(
    user: User,
    checks: Array<{ action: Action; resource: Resource; context?: Record<string, unknown> }>
  ): { allAllowed: boolean; results: Array<{ allowed: boolean; action: Action; resource: Resource }> } {
    const results = checks.map((check) => ({
      ...this.checkPermission(user, check.action, check.resource, check.context),
      action: check.action,
      resource: check.resource,
    }));

    return {
      allAllowed: results.every((r) => r.allowed),
      results,
    };
  }

  /**
   * Get all available roles
   */
  getAvailableRoles(): Role[] {
    return Object.values(this.roles);
  }

  /**
   * Check if a role exists
   */
  roleExists(roleName: string): boolean {
    return roleName in this.roles;
  }
}

export const rbacEngine = new RbacEngine();
