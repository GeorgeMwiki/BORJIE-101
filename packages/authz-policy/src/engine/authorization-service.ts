// @ts-nocheck — schema drift between domain-models Policy type and authz-policy; tracked for rewrite
/**
 * Authorization Service
 * 
 * Unified authorization service that combines RBAC permission checks
 * with ABAC policy evaluation for comprehensive access control.
 */

import type {
  TenantId,
  UserId,
  OrganizationId,
} from '@borjie/domain-models';
import {
  type User,
  type AuthorizationRequest,
  type AuthorizationDecision,
  type SubjectAttributes,
  type ResourceAttributes,
  type ContextAttributes,
  type ActionAttributes,
  asTenantId,
  asOrganizationId,
  asUserId,
} from '@borjie/domain-models';
import { PermissionResolver, type RoleResolver, type ResolvedPermissions } from './permission-resolver.js';
import { PolicyEvaluator, type PolicyStore } from './policy-evaluator.js';

/** Authorization result with detailed information */
export interface AuthorizationResult {
  /** Whether access is allowed */
  readonly allowed: boolean;
  /** Source of the decision */
  readonly source: 'rbac' | 'abac' | 'both';
  /** RBAC check result */
  readonly rbacResult: RbacResult;
  /** ABAC check result */
  readonly abacResult: AbacResult | null;
  /** Combined reason for the decision */
  readonly reason: string;
}

/** RBAC check result */
export interface RbacResult {
  readonly allowed: boolean;
  readonly hadPermission: boolean;
  readonly checkedPermission: string;
}

/** ABAC check result */
export interface AbacResult {
  readonly allowed: boolean;
  readonly decision: AuthorizationDecision;
}

/** Resource context for authorization */
export interface ResourceContext {
  readonly type: string;
  readonly id?: string;
  readonly organizationId?: string;
  readonly ownerId?: string;
  readonly metadata?: Record<string, unknown>;
}

/** Request context for authorization */
export interface RequestContext {
  readonly ipAddress: string;
  readonly userAgent: string;
  readonly requestId: string;
  readonly sessionId?: string;
  readonly metadata?: Record<string, unknown>;
}

/** Authorization service configuration */
export interface AuthorizationServiceConfig {
  /** Enable ABAC policy evaluation (in addition to RBAC) */
  enableAbac: boolean;
  /** Require BOTH RBAC and ABAC to pass (true) or EITHER (false) */
  requireBoth: boolean;
  /** Enable audit logging of authorization decisions */
  enableAuditLog: boolean;
}

const DEFAULT_CONFIG: AuthorizationServiceConfig = {
  enableAbac: true,
  requireBoth: true, // Both RBAC permission AND ABAC policy must allow
  enableAuditLog: true,
};

/**
 * Unified authorization service combining RBAC and ABAC.
 */
export class AuthorizationService {
  private readonly permissionResolver: PermissionResolver;
  private readonly policyEvaluator: PolicyEvaluator;
  private readonly config: AuthorizationServiceConfig;
  
  constructor(
    roleResolver: RoleResolver,
    policyStore: PolicyStore,
    config?: Partial<AuthorizationServiceConfig>
  ) {
    this.permissionResolver = new PermissionResolver(roleResolver);
    this.policyEvaluator = new PolicyEvaluator(policyStore);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Check if a user is authorized to perform an action on a resource.
   */
  async authorize(
    user: User,
    action: string,
    resource: ResourceContext,
    context: RequestContext
  ): Promise<AuthorizationResult> {
    // Build the required permission string
    const requiredPermission = `${resource.type}:${action}`;
    
    // Step 1: RBAC check
    const rbacResult = await this.checkRbac(user, requiredPermission, resource);
    
    // If ABAC is disabled, return RBAC result
    if (!this.config.enableAbac) {
      return {
        allowed: rbacResult.allowed,
        source: 'rbac',
        rbacResult,
        abacResult: null,
        reason: rbacResult.allowed
          ? `RBAC: Has permission ${requiredPermission}`
          : `RBAC: Missing permission ${requiredPermission}`,
      };
    }
    
    // Step 2: ABAC check
    const abacResult = await this.checkAbac(user, action, resource, context);
    
    // Combine results based on configuration
    let allowed: boolean;
    let source: 'rbac' | 'abac' | 'both';
    let reason: string;
    
    if (this.config.requireBoth) {
      // Both must allow
      allowed = rbacResult.allowed && abacResult.allowed;
      source = 'both';
      
      if (!rbacResult.allowed && !abacResult.allowed) {
        reason = `Denied: Missing permission AND policy denied`;
      } else if (!rbacResult.allowed) {
        reason = `Denied by RBAC: Missing permission ${requiredPermission}`;
      } else if (!abacResult.allowed) {
        reason = `Denied by ABAC: ${abacResult.decision.reason}`;
      } else {
        reason = `Allowed: Has permission AND policy allowed`;
      }
    } else {
      // Either can allow (RBAC or ABAC)
      allowed = rbacResult.allowed || abacResult.allowed;
      source = rbacResult.allowed ? 'rbac' : 'abac';
      reason = allowed
        ? `Allowed by ${source.toUpperCase()}`
        : `Denied: Neither RBAC nor ABAC allowed`;
    }
    
    return {
      allowed,
      source,
      rbacResult,
      abacResult,
      reason,
    };
  }
  
  /**
   * Simple permission check (RBAC only).
   */
  async hasPermission(user: User, permission: string): Promise<boolean> {
    return this.permissionResolver.hasPermission(user, permission);
  }
  
  /**
   * Get resolved permissions for a user.
   */
  async getPermissions(user: User): Promise<ResolvedPermissions> {
    return this.permissionResolver.resolvePermissions(user);
  }
  
  /**
   * Invalidate cached permissions for a user.
   */
  invalidateUserPermissions(userId: UserId, tenantId: TenantId): void {
    this.permissionResolver.invalidateUser(userId, tenantId);
  }
  
  /**
   * Perform RBAC permission check.
   */
  private async checkRbac(
    user: User,
    permission: string,
    resource: ResourceContext
  ): Promise<RbacResult> {
    let allowed: boolean;
    
    // If resource has an organization context, check org-specific permissions
    if (resource.organizationId) {
      allowed = await this.permissionResolver.hasPermissionInOrg(
        user,
        permission,
        asOrganizationId(resource.organizationId)
      );
    } else {
      allowed = await this.permissionResolver.hasPermission(user, permission);
    }
    
    return {
      allowed,
      hadPermission: allowed,
      checkedPermission: permission,
    };
  }
  
  /**
   * Perform ABAC policy evaluation.
   */
  private async checkAbac(
    user: User,
    action: string,
    resource: ResourceContext,
    context: RequestContext
  ): Promise<AbacResult> {
    const resolved = await this.permissionResolver.resolvePermissions(user);
    
    const request: AuthorizationRequest = {
      subject: this.buildSubjectAttributes(user, resolved),
      action: this.buildActionAttributes(action, resource.type),
      resource: this.buildResourceAttributes(resource, user.tenantId),
      context: this.buildContextAttributes(context),
    };
    
    const decision = await this.policyEvaluator.evaluate(request);
    
    return {
      allowed: decision.allowed,
      decision,
    };
  }
  
  /**
   * Build subject attributes for policy evaluation.
   */
  private buildSubjectAttributes(
    user: User,
    resolved: ResolvedPermissions
  ): SubjectAttributes {
    return {
      userId: user.id,
      tenantId: user.tenantId,
      userType: user.type,
      roleIds: user.roleAssignments.map((a: { roleId: string; organizationId: string; expiresAt?: string }) => a.roleId),
      organizationIds: Array.from(
        new Set([
          user.primaryOrganizationId,
          ...user.roleAssignments.map((a: { roleId: string; organizationId: string; expiresAt?: string }) => a.organizationId),
        ])
      ),
      primaryOrganizationId: user.primaryOrganizationId,
      permissions: Array.from(resolved.permissions),
      mfaVerified: user.security.mfaEnabled,
      metadata: {},
    };
  }
  
  /**
   * Build action attributes for policy evaluation.
   */
  private buildActionAttributes(action: string, resourceType: string): ActionAttributes {
    return {
      name: action,
      resource: resourceType,
      metadata: {},
    };
  }
  
  /**
   * Build resource attributes for policy evaluation.
   */
  private buildResourceAttributes(
    resource: ResourceContext,
    tenantId: TenantId
  ): ResourceAttributes {
    return {
      type: resource.type,
      id: resource.id ?? null,
      tenantId,
      organizationId: resource.organizationId ? asOrganizationId(resource.organizationId) : null,
      ownerId: resource.ownerId ? asUserId(resource.ownerId) : null,
      metadata: resource.metadata ?? {},
    };
  }
  
  /**
   * Build context attributes for policy evaluation.
   */
  private buildContextAttributes(context: RequestContext): ContextAttributes {
    return {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      timestamp: new Date().toISOString(),
      requestId: context.requestId,
      sessionId: context.sessionId ?? null,
      metadata: context.metadata ?? {},
    };
  }
}

/**
 * Create an authorization service with the given dependencies.
 */
export function createAuthorizationService(
  roleResolver: RoleResolver,
  policyStore: PolicyStore,
  config?: Partial<AuthorizationServiceConfig>
): AuthorizationService {
  return new AuthorizationService(roleResolver, policyStore, config);
}
