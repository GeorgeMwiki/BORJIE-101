/**
 * Authorization middleware for HTTP/API frameworks.
 */

import { AuthSubject, AuthContext, Action, Resource, AuthDecision } from './types.js';
import { PolicyEngine, getPolicyEngine } from './policy-engine.js';

// ============================================================================
// Types
// ============================================================================

/**
 * HTTP Request with auth context attached.
 */
export interface AuthenticatedRequest {
  auth?: AuthSubject;
  [key: string]: unknown;
}

/**
 * Middleware options.
 */
export interface AuthMiddlewareOptions {
  /**
   * Custom policy engine instance. Uses default if not provided.
   */
  engine?: PolicyEngine;

  /**
   * Function to extract resource ID from request.
   */
  extractResourceId?: (req: AuthenticatedRequest) => string | undefined;

  /**
   * Function to extract resource attributes from request.
   */
  extractAttributes?: (req: AuthenticatedRequest) => Record<string, unknown> | undefined;

  /**
   * Custom error handler.
   */
  onDenied?: (req: AuthenticatedRequest, decision: AuthDecision) => void;
}

// ============================================================================
// Middleware Factory
// ============================================================================

/**
 * Create authorization middleware for protecting routes.
 *
 * @example
 * ```typescript
 * // Express.js example
 * app.post(
 *   '/api/properties',
 *   authorize('property', 'create'),
 *   createPropertyHandler
 * );
 * ```
 */
export function authorize(
  resource: Resource,
  action: Action,
  options: AuthMiddlewareOptions = {}
) {
  const engine = options.engine || getPolicyEngine();

  return async (
    req: AuthenticatedRequest,
    _res: unknown,
    next: (error?: Error) => void
  ): Promise<void> => {
    try {
      // Check if user is authenticated
      if (!req.auth) {
        const error = new AuthorizationError('Authentication required', 'UNAUTHENTICATED');
        return next(error);
      }

      // Build auth context
      const context: AuthContext = {
        subject: req.auth,
        action,
        object: {
          resource,
          id: options.extractResourceId?.(req),
          tenantId: req.auth.tenantId,
          attributes: options.extractAttributes?.(req),
        },
      };

      // Evaluate authorization
      const decision = engine.evaluate(context);

      if (!decision.allowed) {
        options.onDenied?.(req, decision);
        const error = new AuthorizationError(
          decision.reason || 'Access denied',
          'FORBIDDEN'
        );
        return next(error);
      }

      // Authorization passed
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error(String(error)));
    }
  };
}

/**
 * Create middleware that requires specific roles.
 */
export function requireRoles(
  roles: string[],
  mode: 'any' | 'all' = 'any'
) {
  return async (
    req: AuthenticatedRequest,
    _res: unknown,
    next: (error?: Error) => void
  ): Promise<void> => {
    try {
      if (!req.auth) {
        return next(new AuthorizationError('Authentication required', 'UNAUTHENTICATED'));
      }

      const userRoles = req.auth.roles || [];
      let hasAccess = false;

      if (mode === 'any') {
        hasAccess = roles.some((role) => userRoles.includes(role));
      } else {
        hasAccess = roles.every((role) => userRoles.includes(role));
      }

      if (!hasAccess) {
        return next(
          new AuthorizationError(
            `Required roles: ${roles.join(mode === 'any' ? ' OR ' : ' AND ')}`,
            'FORBIDDEN'
          )
        );
      }

      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error(String(error)));
    }
  };
}

/**
 * Create middleware that enforces tenant isolation.
 */
export function enforceTenantIsolation(
  extractTenantId: (req: AuthenticatedRequest) => string | undefined
) {
  return async (
    req: AuthenticatedRequest,
    _res: unknown,
    next: (error?: Error) => void
  ): Promise<void> => {
    try {
      if (!req.auth) {
        return next(new AuthorizationError('Authentication required', 'UNAUTHENTICATED'));
      }

      const resourceTenantId = extractTenantId(req);

      if (resourceTenantId && resourceTenantId !== req.auth.tenantId) {
        return next(
          new AuthorizationError('Cross-tenant access denied', 'TENANT_ISOLATION_VIOLATION')
        );
      }

      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error(String(error)));
    }
  };
}

// ============================================================================
// Error Class
// ============================================================================

export type AuthorizationErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'TENANT_ISOLATION_VIOLATION'
  | 'INVALID_TOKEN'
  | 'TOKEN_EXPIRED';

export class AuthorizationError extends Error {
  public readonly code: AuthorizationErrorCode;
  public readonly statusCode: number;

  constructor(message: string, code: AuthorizationErrorCode) {
    super(message);
    this.name = 'AuthorizationError';
    this.code = code;
    this.statusCode = code === 'UNAUTHENTICATED' ? 401 : 403;
  }
}

// ============================================================================
// Guard Functions
// ============================================================================

/**
 * Inline authorization check that throws if denied.
 */
export function assertAuthorized(
  subject: AuthSubject,
  action: Action,
  resource: Resource,
  resourceId?: string,
  attributes?: Record<string, unknown>,
  engine?: PolicyEngine
): void {
  const policyEngine = engine || getPolicyEngine();
  const decision = policyEngine.evaluate({
    subject,
    action,
    object: {
      resource,
      id: resourceId,
      tenantId: subject.tenantId,
      attributes,
    },
  });

  if (!decision.allowed) {
    throw new AuthorizationError(decision.reason || 'Access denied', 'FORBIDDEN');
  }
}

/**
 * Inline authorization check that returns boolean.
 */
export function isAuthorized(
  subject: AuthSubject,
  action: Action,
  resource: Resource,
  resourceId?: string,
  attributes?: Record<string, unknown>,
  engine?: PolicyEngine
): boolean {
  const policyEngine = engine || getPolicyEngine();
  return policyEngine.can(subject, action, resource, resourceId, attributes);
}
