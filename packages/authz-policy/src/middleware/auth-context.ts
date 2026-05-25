/**
 * Authentication Context
 * 
 * Provides a standardized authentication context that can be used
 * across different HTTP frameworks (Express, Fastify, Hono, etc.)
 */

import type {
  TenantId,
  UserId,
  SessionId,
  OrganizationId,
  RoleId,
} from '@borjie/domain-models';
import type { AccessTokenClaims } from '@borjie/domain-models';

/** Authentication status */
export const AuthStatus = {
  /** Not authenticated */
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  /** Authenticated but MFA required */
  MFA_REQUIRED: 'MFA_REQUIRED',
  /** Fully authenticated */
  AUTHENTICATED: 'AUTHENTICATED',
  /** Token expired */
  EXPIRED: 'EXPIRED',
  /** Token invalid */
  INVALID: 'INVALID',
} as const;

export type AuthStatus = (typeof AuthStatus)[keyof typeof AuthStatus];

/** Authenticated user context */
export interface AuthenticatedUser {
  readonly userId: UserId;
  readonly tenantId: TenantId;
  readonly sessionId: SessionId;
  readonly userType: string;
  readonly email: string;
  readonly displayName: string;
  readonly roleIds: readonly RoleId[];
  readonly organizationIds: readonly OrganizationId[];
  readonly primaryOrganizationId: OrganizationId;
  readonly mfaVerified: boolean;
  readonly isImpersonated: boolean;
  readonly impersonatorId: UserId | null;
}

/** Authentication context for the current request */
export interface AuthContext {
  /** Authentication status */
  readonly status: AuthStatus;
  /** Authenticated user (if status is AUTHENTICATED) */
  readonly user: AuthenticatedUser | null;
  /** Raw token claims */
  readonly claims: AccessTokenClaims | null;
  /** Authentication error message (if status is INVALID or EXPIRED) */
  readonly error: string | null;
  /** Request correlation ID */
  readonly requestId: string;
  /** Client IP address */
  readonly ipAddress: string;
  /** User agent string */
  readonly userAgent: string;
}

/** Builder for creating AuthContext */
export class AuthContextBuilder {
  private status: AuthStatus = AuthStatus.UNAUTHENTICATED;
  private user: AuthenticatedUser | null = null;
  private claims: AccessTokenClaims | null = null;
  private error: string | null = null;
  private requestId = '';
  private ipAddress = '';
  private userAgent = '';
  
  setUnauthenticated(): this {
    this.status = AuthStatus.UNAUTHENTICATED;
    this.user = null;
    this.claims = null;
    return this;
  }
  
  setMfaRequired(claims: AccessTokenClaims): this {
    this.status = AuthStatus.MFA_REQUIRED;
    this.claims = claims;
    return this;
  }
  
  setAuthenticated(user: AuthenticatedUser, claims: AccessTokenClaims): this {
    this.status = AuthStatus.AUTHENTICATED;
    this.user = user;
    this.claims = claims;
    return this;
  }
  
  setExpired(error: string): this {
    this.status = AuthStatus.EXPIRED;
    this.error = error;
    return this;
  }
  
  setInvalid(error: string): this {
    this.status = AuthStatus.INVALID;
    this.error = error;
    return this;
  }
  
  setRequestInfo(requestId: string, ipAddress: string, userAgent: string): this {
    this.requestId = requestId;
    this.ipAddress = ipAddress;
    this.userAgent = userAgent;
    return this;
  }
  
  build(): AuthContext {
    return {
      status: this.status,
      user: this.user,
      claims: this.claims,
      error: this.error,
      requestId: this.requestId,
      ipAddress: this.ipAddress,
      userAgent: this.userAgent,
    };
  }
}

/** Check if context represents an authenticated user */
export function isAuthenticated(context: AuthContext): context is AuthContext & { user: AuthenticatedUser } {
  return context.status === AuthStatus.AUTHENTICATED && context.user !== null;
}

/** Check if context requires MFA */
export function requiresMfa(context: AuthContext): boolean {
  return context.status === AuthStatus.MFA_REQUIRED;
}

/** Get authenticated user or throw */
export function requireUser(context: AuthContext): AuthenticatedUser {
  if (!isAuthenticated(context)) {
    throw new AuthenticationError('Authentication required');
  }
  return context.user;
}

/** Get tenant ID from context or throw */
export function requireTenantId(context: AuthContext): TenantId {
  const user = requireUser(context);
  return user.tenantId;
}

/** Authentication error */
export class AuthenticationError extends Error {
  readonly code = 'AUTHENTICATION_ERROR';
  readonly statusCode = 401;
  
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/** Authorization error */
export class AuthorizationError extends Error {
  readonly code = 'AUTHORIZATION_ERROR';
  readonly statusCode = 403;
  readonly resource: string;
  readonly action: string;
  
  constructor(message: string, resource: string, action: string) {
    super(message);
    this.name = 'AuthorizationError';
    this.resource = resource;
    this.action = action;
  }
}

/** Async local storage for auth context */
import { AsyncLocalStorage } from 'node:async_hooks';

const authContextStorage = new AsyncLocalStorage<AuthContext>();

/**
 * Run a function within an auth context.
 */
export function runWithAuthContext<T>(context: AuthContext, fn: () => T): T {
  return authContextStorage.run(context, fn);
}

/**
 * Run an async function within an auth context.
 */
export async function runWithAuthContextAsync<T>(
  context: AuthContext,
  fn: () => Promise<T>
): Promise<T> {
  return authContextStorage.run(context, fn);
}

/**
 * Get the current auth context from async local storage.
 */
export function getCurrentAuthContext(): AuthContext | undefined {
  return authContextStorage.getStore();
}

/**
 * Get the current auth context, throwing if not available.
 */
export function requireAuthContext(): AuthContext {
  const context = authContextStorage.getStore();
  if (!context) {
    throw new Error('No auth context available. Ensure operation is running within runWithAuthContext.');
  }
  return context;
}

/**
 * Get the current authenticated user, throwing if not authenticated.
 */
export function requireCurrentUser(): AuthenticatedUser {
  const context = requireAuthContext();
  return requireUser(context);
}
