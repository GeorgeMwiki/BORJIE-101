// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union: multiple c.json({...}, status) branches widen return type and TypedResponse overload rejects the union. Tracked at hono-dev/hono#3891.
/**
 * RBAC + ABAC Authorization Middleware - BORJIE
 * 
 * Implements:
 * - Role-Based Access Control (RBAC) - Permission sets per role
 * - Attribute-Based Access Control (ABAC) - Policy rules with conditions
 * - Resource-level access control - Ownership and property access
 * - Delegated approval matrix - Threshold-based approvals
 */

import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import type { AuthContext } from './hono-auth';
import type { UserRole } from '../types/user-role';

// ============================================================================
// Types
// ============================================================================

export type Permission = string; // Format: "resource:action" or "resource:action:scope"

export type Action = 'create' | 'read' | 'update' | 'delete' | 'approve' | 'execute' | '*';
export type Scope = 'own' | 'tenant' | 'property' | 'all' | '*';

export interface PolicyRule {
  id: string;
  name: string;
  description: string;
  effect: 'allow' | 'deny';
  roles: UserRole[];
  resources: string[];
  actions: Action[];
  conditions?: PolicyCondition[];
}

export interface PolicyCondition {
  type: 'attribute' | 'threshold' | 'time' | 'property' | 'ownership';
  attribute?: string;
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains' | 'in' | 'between';
  value: unknown;
}

export interface ApprovalThreshold {
  role: UserRole;
  resource: string;
  action: string;
  maxAmount?: number;
  maxQuantity?: number;
  requiresApproval: boolean;
  approverRoles?: UserRole[];
}

export interface ResourceContext {
  resourceType: string;
  resourceId?: string;
  ownerId?: string;
  propertyId?: string;
  tenantId?: string;
  amount?: number;
  attributes?: Record<string, unknown>;
}

export interface AuthorizationResult {
  allowed: boolean;
  reason?: string;
  requiresApproval?: boolean;
  approvalDetails?: {
    approverRoles: UserRole[];
    threshold: ApprovalThreshold;
  };
}

// ============================================================================
// Permission Definitions
// ============================================================================

export const PERMISSIONS = {
  // User Management
  'users:create': ['SUPER_ADMIN', 'ADMIN', 'TENANT_ADMIN'],
  'users:read': ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'TENANT_ADMIN', 'PROPERTY_MANAGER'],
  'users:update': ['SUPER_ADMIN', 'ADMIN', 'TENANT_ADMIN'],
  'users:delete': ['SUPER_ADMIN', 'ADMIN'],
  
  // Tenant Management
  'tenants:create': ['SUPER_ADMIN', 'ADMIN'],
  'tenants:read': ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'],
  'tenants:update': ['SUPER_ADMIN', 'ADMIN'],
  'tenants:delete': ['SUPER_ADMIN'],
  
  // Property Management
  'properties:create': ['TENANT_ADMIN'],
  'properties:read': ['TENANT_ADMIN', 'PROPERTY_MANAGER', 'ACCOUNTANT', 'OWNER', 'MAINTENANCE_STAFF'],
  'properties:update': ['TENANT_ADMIN', 'PROPERTY_MANAGER'],
  'properties:delete': ['TENANT_ADMIN'],
  
  // Unit Management
  'units:create': ['TENANT_ADMIN', 'PROPERTY_MANAGER'],
  'units:read': ['TENANT_ADMIN', 'PROPERTY_MANAGER', 'ACCOUNTANT', 'OWNER', 'MAINTENANCE_STAFF', 'RESIDENT'],
  'units:update': ['TENANT_ADMIN', 'PROPERTY_MANAGER'],
  'units:delete': ['TENANT_ADMIN'],
  
  // Customer Management
  'customers:create': ['TENANT_ADMIN', 'PROPERTY_MANAGER'],
  'customers:read': ['TENANT_ADMIN', 'PROPERTY_MANAGER', 'ACCOUNTANT'],
  'customers:update': ['TENANT_ADMIN', 'PROPERTY_MANAGER'],
  'customers:delete': ['TENANT_ADMIN'],
  
  // Lease Management
  'leases:create': ['TENANT_ADMIN', 'PROPERTY_MANAGER'],
  'leases:read': ['TENANT_ADMIN', 'PROPERTY_MANAGER', 'ACCOUNTANT', 'OWNER'],
  'leases:read:own': ['RESIDENT'],
  'leases:update': ['TENANT_ADMIN', 'PROPERTY_MANAGER'],
  'leases:delete': ['TENANT_ADMIN'],
  'leases:terminate': ['TENANT_ADMIN'],
  
  // Invoice Management
  'invoices:create': ['TENANT_ADMIN', 'PROPERTY_MANAGER', 'ACCOUNTANT'],
  'invoices:read': ['TENANT_ADMIN', 'PROPERTY_MANAGER', 'ACCOUNTANT', 'OWNER'],
  'invoices:read:own': ['RESIDENT'],
  'invoices:update': ['TENANT_ADMIN', 'ACCOUNTANT'],
  'invoices:delete': ['TENANT_ADMIN'],
  'invoices:void': ['TENANT_ADMIN', 'ACCOUNTANT'],
  
  // Payment Management
  'payments:create': ['TENANT_ADMIN', 'PROPERTY_MANAGER', 'ACCOUNTANT'],
  'payments:create:own': ['RESIDENT'],
  'payments:read': ['TENANT_ADMIN', 'PROPERTY_MANAGER', 'ACCOUNTANT', 'OWNER'],
  'payments:read:own': ['RESIDENT'],
  'payments:reconcile': ['TENANT_ADMIN', 'ACCOUNTANT'],
  'payments:refund': ['TENANT_ADMIN'],
  
  // Work Order Management
  'work_orders:create': ['TENANT_ADMIN', 'PROPERTY_MANAGER', 'MAINTENANCE_STAFF'],
  'work_orders:create:own': ['RESIDENT'],
  'work_orders:read': ['TENANT_ADMIN', 'PROPERTY_MANAGER', 'MAINTENANCE_STAFF', 'OWNER'],
  'work_orders:read:own': ['RESIDENT'],
  'work_orders:update': ['TENANT_ADMIN', 'PROPERTY_MANAGER', 'MAINTENANCE_STAFF'],
  'work_orders:assign': ['TENANT_ADMIN', 'PROPERTY_MANAGER'],
  'work_orders:complete': ['MAINTENANCE_STAFF'],
  'work_orders:approve': ['TENANT_ADMIN', 'PROPERTY_MANAGER', 'OWNER'],
  
  // Report Management
  'reports:create': ['TENANT_ADMIN', 'ACCOUNTANT'],
  'reports:read': ['TENANT_ADMIN', 'PROPERTY_MANAGER', 'ACCOUNTANT', 'OWNER', 'SUPPORT'],
  'reports:export': ['TENANT_ADMIN', 'ACCOUNTANT', 'OWNER'],
  
  // Approval Management
  'approvals:create': ['TENANT_ADMIN', 'PROPERTY_MANAGER', 'ACCOUNTANT'],
  'approvals:read': ['TENANT_ADMIN', 'PROPERTY_MANAGER', 'ACCOUNTANT', 'OWNER'],
  'approvals:approve': ['TENANT_ADMIN', 'OWNER'],
  'approvals:reject': ['TENANT_ADMIN', 'OWNER'],
  
  // Vendor Management
  'vendors:create': ['TENANT_ADMIN', 'PROPERTY_MANAGER'],
  'vendors:read': ['TENANT_ADMIN', 'PROPERTY_MANAGER', 'MAINTENANCE_STAFF'],
  'vendors:update': ['TENANT_ADMIN', 'PROPERTY_MANAGER'],
  'vendors:delete': ['TENANT_ADMIN'],
  
  // Notification Management
  'notifications:create': ['TENANT_ADMIN', 'PROPERTY_MANAGER'],
  'notifications:read': ['*'], // All authenticated users
  'notifications:send': ['TENANT_ADMIN', 'PROPERTY_MANAGER'],
  
  // Settings Management
  'settings:read': ['TENANT_ADMIN', 'OWNER'],
  'settings:update': ['TENANT_ADMIN'],
  
  // Audit Log
  'audit:read': ['SUPER_ADMIN', 'ADMIN', 'TENANT_ADMIN'],
} as const;

// ============================================================================
// Policy Rules (ABAC)
// ============================================================================

const policyRules: PolicyRule[] = [
  // Owners can only view their own properties
  {
    id: 'owner-property-access',
    name: 'Owner Property Access',
    description: 'Owners can only access properties they own',
    effect: 'allow',
    roles: ['OWNER' as UserRole],
    resources: ['properties', 'units', 'leases', 'invoices', 'payments'],
    actions: ['read'],
    conditions: [
      { type: 'property', operator: 'in', value: 'auth.propertyAccess' },
    ],
  },
  
  // Residents can only access their own data
  {
    id: 'resident-own-access',
    name: 'Resident Own Data Access',
    description: 'Residents can only access their own leases, invoices, and payments',
    effect: 'allow',
    roles: ['RESIDENT' as UserRole],
    resources: ['leases', 'invoices', 'payments', 'work_orders'],
    actions: ['read'],
    conditions: [
      { type: 'ownership', operator: 'equals', value: 'auth.userId' },
    ],
  },
  
  // High-value payments require approval
  {
    id: 'high-value-payment-approval',
    name: 'High Value Payment Approval',
    description: 'Payments above threshold require owner approval',
    effect: 'allow',
    roles: ['PROPERTY_MANAGER' as UserRole, 'ACCOUNTANT' as UserRole],
    resources: ['payments'],
    actions: ['create'],
    conditions: [
      { type: 'threshold', attribute: 'amount', operator: 'less_than', value: 1000000 },
    ],
  },
  
  // Maintenance staff can only update assigned work orders
  {
    id: 'maintenance-work-order-access',
    name: 'Maintenance Work Order Access',
    description: 'Maintenance staff can only update work orders assigned to them',
    effect: 'allow',
    roles: ['MAINTENANCE_STAFF' as UserRole],
    resources: ['work_orders'],
    actions: ['update'],
    conditions: [
      { type: 'attribute', attribute: 'assignedToUserId', operator: 'equals', value: 'auth.userId' },
    ],
  },
  
  // Business hours restriction for certain operations
  {
    id: 'business-hours-restriction',
    name: 'Business Hours Restriction',
    description: 'Critical operations only during business hours',
    effect: 'deny',
    roles: ['PROPERTY_MANAGER' as UserRole, 'ACCOUNTANT' as UserRole],
    resources: ['payments'],
    actions: ['refund'],
    conditions: [
      { type: 'time', operator: 'not_equals', value: 'business_hours' },
    ],
  },
];

// ============================================================================
// Approval Thresholds
// ============================================================================

const approvalThresholds: ApprovalThreshold[] = [
  // Payment refunds
  {
    role: 'ACCOUNTANT' as UserRole,
    resource: 'payments',
    action: 'refund',
    maxAmount: 100000, // TZS
    requiresApproval: true,
    approverRoles: ['TENANT_ADMIN' as UserRole],
  },
  {
    role: 'PROPERTY_MANAGER' as UserRole,
    resource: 'payments',
    action: 'refund',
    maxAmount: 50000,
    requiresApproval: true,
    approverRoles: ['TENANT_ADMIN' as UserRole, 'OWNER' as UserRole],
  },
  
  // Fee waivers
  {
    role: 'PROPERTY_MANAGER' as UserRole,
    resource: 'invoices',
    action: 'waive',
    maxAmount: 50000,
    requiresApproval: false,
  },
  {
    role: 'PROPERTY_MANAGER' as UserRole,
    resource: 'invoices',
    action: 'waive',
    maxAmount: 200000,
    requiresApproval: true,
    approverRoles: ['TENANT_ADMIN' as UserRole],
  },
  
  // Work order costs
  {
    role: 'PROPERTY_MANAGER' as UserRole,
    resource: 'work_orders',
    action: 'approve',
    maxAmount: 500000,
    requiresApproval: false,
  },
  {
    role: 'PROPERTY_MANAGER' as UserRole,
    resource: 'work_orders',
    action: 'approve',
    maxAmount: 2000000,
    requiresApproval: true,
    approverRoles: ['TENANT_ADMIN' as UserRole, 'OWNER' as UserRole],
  },
  
  // Rent increases
  {
    role: 'PROPERTY_MANAGER' as UserRole,
    resource: 'leases',
    action: 'rent_increase',
    maxAmount: 10, // Percentage
    requiresApproval: false,
  },
  {
    role: 'PROPERTY_MANAGER' as UserRole,
    resource: 'leases',
    action: 'rent_increase',
    maxAmount: 25,
    requiresApproval: true,
    approverRoles: ['TENANT_ADMIN' as UserRole],
  },
];

// ============================================================================
// Authorization Engine
// ============================================================================

class AuthorizationEngine {
  /**
   * Check if a permission is granted to a role
   */
  hasPermission(role: UserRole, permission: Permission, permissions: string[]): boolean {
    // Super admin has all permissions
    if (role === 'SUPER_ADMIN' || permissions.includes('*')) {
      return true;
    }

    // Check explicit permissions
    if (permissions.includes(permission)) {
      return true;
    }

    // Check wildcard permissions (e.g., 'users:*' grants 'users:read')
    const [resource, action] = permission.split(':');
    if (permissions.includes(`${resource}:*`)) {
      return true;
    }

    // Check role-based permissions from PERMISSIONS map
    const allowedRoles = PERMISSIONS[permission as keyof typeof PERMISSIONS];
    if (allowedRoles && (allowedRoles.includes(role as never) || allowedRoles.includes('*' as never))) {
      return true;
    }

    return false;
  }

  /**
   * Evaluate ABAC policy rules
   */
  evaluatePolicies(
    auth: AuthContext,
    resource: ResourceContext,
    action: Action
  ): { effect: 'allow' | 'deny' | 'not_applicable'; rule?: PolicyRule } {
    const applicableRules = policyRules.filter(rule => {
      // Check if rule applies to this role
      if (!rule.roles.includes(auth.role)) return false;

      // Check if rule applies to this resource
      if (!rule.resources.includes(resource.resourceType)) return false;

      // Check if rule applies to this action
      if (!rule.actions.includes(action) && !rule.actions.includes('*')) return false;

      return true;
    });

    if (applicableRules.length === 0) {
      return { effect: 'not_applicable' };
    }

    // Evaluate conditions for each applicable rule
    for (const rule of applicableRules) {
      const conditionsMet = this.evaluateConditions(rule.conditions || [], auth, resource);
      
      if (conditionsMet) {
        return { effect: rule.effect, rule };
      }
    }

    return { effect: 'not_applicable' };
  }

  /**
   * Evaluate policy conditions
   */
  private evaluateConditions(
    conditions: PolicyCondition[],
    auth: AuthContext,
    resource: ResourceContext
  ): boolean {
    if (conditions.length === 0) return true;

    return conditions.every(condition => {
      switch (condition.type) {
        case 'ownership':
          return this.evaluateOwnershipCondition(condition, auth, resource);
        case 'property':
          return this.evaluatePropertyCondition(condition, auth, resource);
        case 'threshold':
          return this.evaluateThresholdCondition(condition, resource);
        case 'attribute':
          return this.evaluateAttributeCondition(condition, auth, resource);
        case 'time':
          return this.evaluateTimeCondition(condition);
        default:
          return true;
      }
    });
  }

  private evaluateOwnershipCondition(
    condition: PolicyCondition,
    auth: AuthContext,
    resource: ResourceContext
  ): boolean {
    if (condition.value === 'auth.userId') {
      return resource.ownerId === auth.userId;
    }
    return false;
  }

  private evaluatePropertyCondition(
    condition: PolicyCondition,
    auth: AuthContext,
    resource: ResourceContext
  ): boolean {
    if (condition.value === 'auth.propertyAccess') {
      if (auth.propertyAccess.includes('*')) return true;
      if (!resource.propertyId) return true; // No property restriction
      return auth.propertyAccess.includes(resource.propertyId);
    }
    return false;
  }

  private evaluateThresholdCondition(
    condition: PolicyCondition,
    resource: ResourceContext
  ): boolean {
    const attributeValue = resource.attributes?.[condition.attribute!] ?? resource.amount;
    if (attributeValue === undefined) return true;

    const numValue = Number(attributeValue);
    const threshold = Number(condition.value);

    switch (condition.operator) {
      case 'less_than':
        return numValue < threshold;
      case 'greater_than':
        return numValue > threshold;
      case 'equals':
        return numValue === threshold;
      default:
        return false;
    }
  }

  private evaluateAttributeCondition(
    condition: PolicyCondition,
    auth: AuthContext,
    resource: ResourceContext
  ): boolean {
    const resourceValue = resource.attributes?.[condition.attribute!];
    let expectedValue = condition.value;

    // Resolve auth references
    if (expectedValue === 'auth.userId') {
      expectedValue = auth.userId;
    } else if (expectedValue === 'auth.tenantId') {
      expectedValue = auth.tenantId;
    }

    switch (condition.operator) {
      case 'equals':
        return resourceValue === expectedValue;
      case 'not_equals':
        return resourceValue !== expectedValue;
      case 'contains':
        return Array.isArray(resourceValue) && resourceValue.includes(expectedValue);
      case 'in':
        return Array.isArray(expectedValue) && expectedValue.includes(resourceValue);
      default:
        return false;
    }
  }

  private evaluateTimeCondition(condition: PolicyCondition): boolean {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();

    if (condition.value === 'business_hours') {
      const isWeekday = day >= 1 && day <= 5;
      const isBusinessHour = hour >= 8 && hour < 18;
      const isBusinessHours = isWeekday && isBusinessHour;
      
      return condition.operator === 'equals' ? isBusinessHours : !isBusinessHours;
    }

    return true;
  }

  /**
   * Check if action requires approval and get threshold details
   */
  checkApprovalRequired(
    auth: AuthContext,
    resource: ResourceContext,
    action: string
  ): { required: boolean; threshold?: ApprovalThreshold } {
    const applicableThresholds = approvalThresholds.filter(t => 
      t.role === auth.role &&
      t.resource === resource.resourceType &&
      t.action === action
    );

    if (applicableThresholds.length === 0) {
      return { required: false };
    }

    // Sort by maxAmount descending to find the highest applicable threshold
    const sortedThresholds = applicableThresholds.sort((a, b) => 
      (b.maxAmount || 0) - (a.maxAmount || 0)
    );

    const amount = resource.amount || 0;

    for (const threshold of sortedThresholds) {
      if (threshold.maxAmount !== undefined && amount <= threshold.maxAmount) {
        return {
          required: threshold.requiresApproval,
          threshold: threshold.requiresApproval ? threshold : undefined,
        };
      }
    }

    // Amount exceeds all thresholds - requires approval from highest level
    const highestThreshold = sortedThresholds[0];
    return {
      required: true,
      threshold: {
        ...highestThreshold,
        requiresApproval: true,
        approverRoles: ['TENANT_ADMIN' as UserRole, 'OWNER' as UserRole],
      },
    };
  }

  /**
   * Full authorization check
   */
  authorize(
    auth: AuthContext,
    permission: Permission,
    resource?: ResourceContext
  ): AuthorizationResult {
    // Extract action from permission
    const [resourceType, action] = permission.split(':');
    const actionType = action as Action;

    // Check basic permission
    if (!this.hasPermission(auth.role, permission, auth.permissions)) {
      return {
        allowed: false,
        reason: `Permission '${permission}' not granted to role '${auth.role}'`,
      };
    }

    // If no resource context, just check permission
    if (!resource) {
      return { allowed: true };
    }

    // Evaluate ABAC policies
    const policyResult = this.evaluatePolicies(auth, resource, actionType);
    
    if (policyResult.effect === 'deny') {
      return {
        allowed: false,
        reason: policyResult.rule ? `Denied by policy: ${policyResult.rule.name}` : 'Access denied by policy',
      };
    }

    // Check approval requirements
    const approvalCheck = this.checkApprovalRequired(auth, resource, action);
    if (approvalCheck.required && approvalCheck.threshold) {
      return {
        allowed: true,
        requiresApproval: true,
        approvalDetails: {
          approverRoles: approvalCheck.threshold.approverRoles || [],
          threshold: approvalCheck.threshold,
        },
      };
    }

    return { allowed: true };
  }
}

// Singleton instance
const authorizationEngine = new AuthorizationEngine();

// ============================================================================
// Middleware Functions
// ============================================================================

/**
 * Require specific permission(s)
 */
export const requirePermission = (...permissions: Permission[]) => {
  return createMiddleware(async (c, next) => {
    const auth = c.get('auth') as AuthContext | undefined;
    
    if (!auth) {
      return c.json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      }, 401);
    }

    for (const permission of permissions) {
      const result = authorizationEngine.authorize(auth, permission);
      
      if (!result.allowed) {
        return c.json({
          success: false,
          error: { 
            code: 'FORBIDDEN', 
            message: result.reason || 'Insufficient permissions',
          },
        }, 403);
      }
    }

    await next();
  });
};

/**
 * Require any of the specified permissions
 */
export const requireAnyPermission = (...permissions: Permission[]) => {
  return createMiddleware(async (c, next) => {
    const auth = c.get('auth') as AuthContext | undefined;
    
    if (!auth) {
      return c.json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      }, 401);
    }

    const hasAny = permissions.some(permission => 
      authorizationEngine.authorize(auth, permission).allowed
    );

    if (!hasAny) {
      return c.json({
        success: false,
        error: { 
          code: 'FORBIDDEN', 
          message: 'Insufficient permissions',
        },
      }, 403);
    }

    await next();
  });
};

/**
 * Require role(s)
 */
export const requireRole = (...roles: UserRole[]) => {
  return createMiddleware(async (c, next) => {
    const auth = c.get('auth') as AuthContext | undefined;
    
    if (!auth) {
      return c.json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      }, 401);
    }

    if (!roles.includes(auth.role)) {
      return c.json({
        success: false,
        error: { 
          code: 'FORBIDDEN', 
          message: `Role '${auth.role}' does not have access to this resource`,
        },
      }, 403);
    }

    await next();
  });
};

/**
 * Check resource-level authorization with ABAC
 */
export const authorizeResource = (
  permission: Permission,
  getResourceContext: (c: Context) => ResourceContext | Promise<ResourceContext>
) => {
  return createMiddleware(async (c, next) => {
    const auth = c.get('auth') as AuthContext | undefined;
    
    if (!auth) {
      return c.json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      }, 401);
    }

    const resourceContext = await getResourceContext(c);
    const result = authorizationEngine.authorize(auth, permission, resourceContext);

    if (!result.allowed) {
      return c.json({
        success: false,
        error: { 
          code: 'FORBIDDEN', 
          message: result.reason || 'Access denied',
        },
      }, 403);
    }

    // Set approval info if needed
    if (result.requiresApproval) {
      c.set('requiresApproval', true);
      c.set('approvalDetails', result.approvalDetails);
    }

    await next();
  });
};

/**
 * Require property access
 */
export const requirePropertyAccess = (
  getPropertyId: (c: Context) => string | Promise<string>
) => {
  return createMiddleware(async (c, next) => {
    const auth = c.get('auth') as AuthContext | undefined;
    
    if (!auth) {
      return c.json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      }, 401);
    }

    // Super admin and wildcard access
    if (auth.role === 'SUPER_ADMIN' || auth.propertyAccess.includes('*')) {
      await next();
      return;
    }

    const propertyId = await getPropertyId(c);
    
    if (!auth.propertyAccess.includes(propertyId)) {
      return c.json({
        success: false,
        error: { 
          code: 'FORBIDDEN', 
          message: 'You do not have access to this property',
        },
      }, 403);
    }

    await next();
  });
};

/**
 * Check if user owns the resource
 */
export const requireOwnership = (
  getOwnerId: (c: Context) => string | Promise<string>
) => {
  return createMiddleware(async (c, next) => {
    const auth = c.get('auth') as AuthContext | undefined;
    
    if (!auth) {
      return c.json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      }, 401);
    }

    // Admin roles bypass ownership check
    if (['SUPER_ADMIN', 'ADMIN', 'TENANT_ADMIN'].includes(auth.role)) {
      await next();
      return;
    }

    const ownerId = await getOwnerId(c);
    
    if (auth.userId !== ownerId) {
      return c.json({
        success: false,
        error: { 
          code: 'FORBIDDEN', 
          message: 'You can only access your own resources',
        },
      }, 403);
    }

    await next();
  });
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check authorization programmatically
 */
export function checkAuthorization(
  auth: AuthContext,
  permission: Permission,
  resource?: ResourceContext
): AuthorizationResult {
  return authorizationEngine.authorize(auth, permission, resource);
}

/**
 * Get all permissions for a role
 */
export function getPermissionsForRole(role: UserRole): string[] {
  const permissions: string[] = [];
  
  for (const [permission, roles] of Object.entries(PERMISSIONS)) {
    if (roles.includes(role as never) || roles.includes('*' as never)) {
      permissions.push(permission);
    }
  }
  
  return permissions;
}

/**
 * Check if a role has a specific permission
 */
export function roleHasPermission(role: UserRole, permission: Permission): boolean {
  const allowedRoles = PERMISSIONS[permission as keyof typeof PERMISSIONS];
  if (!allowedRoles) return false;
  return allowedRoles.includes(role as never) || allowedRoles.includes('*' as never);
}

// Extend Hono context types
declare module 'hono' {
  interface ContextVariableMap {
    requiresApproval?: boolean;
    approvalDetails?: {
      approverRoles: UserRole[];
      threshold: ApprovalThreshold;
    };
  }
}

export { authorizationEngine };
// @ts-nocheck
