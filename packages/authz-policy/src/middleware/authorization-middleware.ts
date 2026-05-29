/**
 * Authorization Middleware
 * 
 * Framework-agnostic authorization middleware that can be adapted
 * for Express, Fastify, Hono, or any other HTTP framework.
 */

import type {
  TenantId,
  UserId,
  User,
} from '@borjie/domain-models';
import {
  type AuthContext,
  type AuthenticatedUser,
  AuthStatus,
  AuthenticationError,
  AuthorizationError,
  isAuthenticated,
} from './auth-context.js';
import {
  type AuthorizationService,
  type ResourceContext,
  type RequestContext,
  type AuthorizationResult,
} from '../engine/authorization-service.js';
import {
  type TenantContext,
  runWithTenantContext,
} from '../engine/tenant-isolation.js';

/** User resolver for fetching full user details */
export interface UserResolver {
  getUserById(userId: UserId, tenantId: TenantId): Promise<User | null>;
}

/** Middleware configuration */
export interface AuthorizationMiddlewareConfig {
  /** Paths that don't require authentication */
  publicPaths: readonly string[];
  /** Paths that require MFA */
  mfaRequiredPaths: readonly string[];
  /** Whether to allow requests without authentication */
  allowAnonymous: boolean;
}

const DEFAULT_CONFIG: AuthorizationMiddlewareConfig = {
  publicPaths: ['/health', '/metrics', '/api/v1/auth/login', '/api/v1/auth/register'],
  mfaRequiredPaths: ['/api/v1/admin', '/api/v1/settings/security'],
  allowAnonymous: false,
};

/**
 * Authorization middleware that handles auth context and permission checks.
 */
export class AuthorizationMiddleware {
  private readonly authService: AuthorizationService;
  private readonly userResolver: UserResolver;
  private readonly config: AuthorizationMiddlewareConfig;
  
  constructor(
    authService: AuthorizationService,
    userResolver: UserResolver,
    config?: Partial<AuthorizationMiddlewareConfig>
  ) {
    this.authService = authService;
    this.userResolver = userResolver;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Check if a path is public (doesn't require authentication).
   */
  isPublicPath(path: string): boolean {
    return this.config.publicPaths.some((p) => 
      path === p || path.startsWith(p + '/')
    );
  }
  
  /**
   * Check if a path requires MFA.
   */
  requiresMfaForPath(path: string): boolean {
    return this.config.mfaRequiredPaths.some((p) =>
      path === p || path.startsWith(p + '/')
    );
  }
  
  /**
   * Validate authentication context for a request.
   */
  validateAuthContext(authContext: AuthContext, path: string): void {
    // Public paths don't need authentication
    if (this.isPublicPath(path)) {
      return;
    }
    
    // Check if anonymous access is allowed
    if (authContext.status === AuthStatus.UNAUTHENTICATED) {
      if (this.config.allowAnonymous) {
        return;
      }
      throw new AuthenticationError('Authentication required');
    }
    
    // Check for expired/invalid tokens
    if (authContext.status === AuthStatus.EXPIRED) {
      throw new AuthenticationError('Token expired');
    }
    
    if (authContext.status === AuthStatus.INVALID) {
      throw new AuthenticationError(authContext.error ?? 'Invalid token');
    }
    
    // Check MFA requirement
    if (authContext.status === AuthStatus.MFA_REQUIRED) {
      if (this.requiresMfaForPath(path)) {
        throw new AuthenticationError('MFA verification required');
      }
    }
    
    // Check MFA for paths that require it
    if (this.requiresMfaForPath(path)) {
      if (!authContext.user?.mfaVerified) {
        throw new AuthenticationError('MFA verification required for this resource');
      }
    }
  }
  
  /**
   * Authorize a request for a specific resource and action.
   */
  async authorizeRequest(
    authContext: AuthContext,
    action: string,
    resource: ResourceContext
  ): Promise<AuthorizationResult> {
    if (!isAuthenticated(authContext)) {
      throw new AuthenticationError('Authentication required');
    }
    
    // Fetch full user details
    const user = await this.userResolver.getUserById(
      authContext.user.userId,
      authContext.user.tenantId
    );
    
    if (!user) {
      throw new AuthenticationError('User not found');
    }
    
    const requestContext: RequestContext = {
      ipAddress: authContext.ipAddress,
      userAgent: authContext.userAgent,
      requestId: authContext.requestId,
      sessionId: authContext.user.sessionId,
    };
    
    const result = await this.authService.authorize(user, action, resource, requestContext);
    
    if (!result.allowed) {
      throw new AuthorizationError(
        result.reason,
        resource.type,
        action
      );
    }
    
    return result;
  }
  
  /**
   * Create tenant context from auth context.
   */
  createTenantContext(authContext: AuthContext): TenantContext | null {
    if (!isAuthenticated(authContext)) {
      return null;
    }
    
    // Check if user is a super admin (for cross-tenant access)
    // This would typically come from a special role or user type
    const isSuperAdmin = authContext.user.userType === 'INTERNAL_ADMIN';
    
    return {
      tenantId: authContext.user.tenantId,
      isSuperAdmin,
    };
  }
  
  /**
   * Execute a function within the appropriate tenant context.
   */
  async executeWithTenantContext<T>(
    authContext: AuthContext,
    fn: () => Promise<T>
  ): Promise<T> {
    const tenantContext = this.createTenantContext(authContext);
    
    if (!tenantContext) {
      throw new AuthenticationError('Authentication required');
    }
    
    return runWithTenantContext(tenantContext, fn);
  }
}

/**
 * Permission decorator factory.
 * Creates a decorator that checks permissions before method execution.
 */
export function requirePermission(permission: string) {
  return function <TThis, TArgs extends unknown[], TReturn>(
    target: (this: TThis, ...args: TArgs) => Promise<TReturn>,
    context: ClassMethodDecoratorContext
  ) {
    return async function (this: TThis, ...args: TArgs): Promise<TReturn> {
      // This would need access to the auth context and authorization service.
      // In practice, this would be injected or accessed via async local storage.
      // Stub no-op: real permission resolution lives in the authorization
      // service; the decorator is a placeholder pending DI integration.
      void permission;
      return target.apply(this, args);
    };
  };
}

/**
 * Resource permission check result.
 */
export interface PermissionCheckResult {
  readonly allowed: boolean;
  readonly permission: string;
  readonly resource: string;
  readonly action: string;
  readonly reason?: string;
}

/**
 * Bulk permission check for multiple resources.
 */
export async function checkBulkPermissions(
  authService: AuthorizationService,
  user: User,
  checks: readonly { action: string; resource: ResourceContext }[],
  context: RequestContext
): Promise<readonly PermissionCheckResult[]> {
  const results: PermissionCheckResult[] = [];
  
  for (const check of checks) {
    const result = await authService.authorize(user, check.action, check.resource, context);
    results.push({
      allowed: result.allowed,
      permission: `${check.resource.type}:${check.action}`,
      resource: check.resource.type,
      action: check.action,
      reason: result.reason,
    });
  }
  
  return results;
}

/**
 * Create a resource context from request parameters.
 */
export function createResourceContext(
  type: string,
  options?: {
    id?: string;
    organizationId?: string;
    ownerId?: string;
    metadata?: Record<string, unknown>;
  }
): ResourceContext {
  return {
    type,
    id: options?.id,
    organizationId: options?.organizationId,
    ownerId: options?.ownerId,
    metadata: options?.metadata,
  };
}

/**
 * Map HTTP method to action name.
 */
export function httpMethodToAction(method: string): string {
  const methodMap: Record<string, string> = {
    GET: 'read',
    POST: 'create',
    PUT: 'update',
    PATCH: 'update',
    DELETE: 'delete',
  };
  return methodMap[method.toUpperCase()] ?? 'read';
}

/**
 * Extract resource type from URL path.
 */
export function extractResourceType(path: string): string {
  // Example: /api/v1/properties/123 -> properties
  const parts = path.split('/').filter(Boolean);
  
  // Skip api version prefix
  const startIndex = parts.findIndex((p) => !p.startsWith('api') && !p.startsWith('v'));
  
  if (startIndex >= 0 && parts[startIndex]) {
    // Return singular form
    const resource = parts[startIndex];
    return resource.endsWith('s') ? resource.slice(0, -1) : resource;
  }
  
  return 'unknown';
}
