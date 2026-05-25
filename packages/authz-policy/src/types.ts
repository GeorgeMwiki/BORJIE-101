/**
 * Authorization types and interfaces.
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Actions that can be performed on resources.
 */
export type Action = 'create' | 'read' | 'update' | 'delete' | 'manage' | 'approve';

/**
 * Resources in the system that require authorization.
 */
export type Resource =
  | 'tenant'
  | 'user'
  | 'role'
  | 'property'
  | 'unit'
  | 'owner_account'
  | 'customer_account'
  | 'lease'
  | 'occupancy'
  | 'payment'
  | 'invoice'
  | 'disbursement'
  | 'work_order'
  | 'vendor'
  | 'document'
  | 'report'
  | 'settings'
  | 'audit_log';

/**
 * The subject requesting access (authenticated user context).
 */
export interface AuthSubject {
  userId: string;
  tenantId: string;
  email: string;
  roles: string[];
  permissions: PolicyPermission[];
  attributes: SubjectAttributes;
}

/**
 * Additional attributes for ABAC evaluation.
 */
export interface SubjectAttributes {
  department?: string;
  managedProperties?: string[];
  assignedUnits?: string[];
  ownedProperties?: string[];
  customerId?: string;
}

/**
 * The target resource being accessed.
 */
export interface AuthObject {
  resource: Resource;
  id?: string;
  tenantId?: string;
  attributes?: Record<string, unknown>;
}

/**
 * Evaluation context passed to the policy engine.
 */
export interface AuthContext {
  subject: AuthSubject;
  action: Action;
  object: AuthObject;
  environment?: EnvironmentContext;
}

/**
 * Environmental factors for policy evaluation.
 */
export interface EnvironmentContext {
  ipAddress?: string;
  userAgent?: string;
  timestamp?: Date;
  requestId?: string;
}

// ============================================================================
// Policy Types
// ============================================================================

/**
 * A permission grant within a policy.
 */
export interface PolicyPermission {
  resource: Resource;
  actions: Action[];
  conditions?: PolicyCondition[];
}

/**
 * Condition for fine-grained access control (ABAC).
 */
export interface PolicyCondition {
  field: string;
  operator: ConditionOperator;
  value: unknown;
}

export type ConditionOperator =
  | 'eq'
  | 'neq'
  | 'in'
  | 'nin'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'exists';

/**
 * A complete policy definition.
 */
export interface Policy {
  id: string;
  name: string;
  description?: string;
  effect: 'allow' | 'deny';
  permissions: PolicyPermission[];
  priority: number; // Higher priority evaluated first
}

// ============================================================================
// Authorization Result Types
// ============================================================================

/**
 * Result of an authorization decision.
 */
export interface AuthDecision {
  allowed: boolean;
  reason?: string;
  matchedPolicy?: string;
  evaluationTime?: number;
}

/**
 * Bulk authorization check result.
 */
export interface BulkAuthDecision {
  results: Map<string, AuthDecision>;
  evaluationTime: number;
}

// ============================================================================
// Policy Engine Configuration
// ============================================================================

/**
 * Configuration for the policy engine.
 */
export interface PolicyEngineConfig {
  /**
   * Whether to enable tenant isolation checks.
   * Should always be true in production.
   */
  enforceTenantIsolation: boolean;

  /**
   * Whether to cache policy evaluations.
   */
  enableCache: boolean;

  /**
   * Cache TTL in milliseconds.
   */
  cacheTtlMs: number;

  /**
   * Default decision when no matching policy is found.
   */
  defaultDecision: 'allow' | 'deny';

  /**
   * Whether to log authorization decisions.
   */
  auditLogging: boolean;
}

/**
 * Default policy engine configuration.
 */
export const defaultPolicyEngineConfig: PolicyEngineConfig = {
  enforceTenantIsolation: true,
  enableCache: true,
  cacheTtlMs: 60000, // 1 minute
  defaultDecision: 'deny',
  auditLogging: true,
};

// ============================================================================
// Token Types
// ============================================================================

/**
 * JWT claims for authenticated users.
 */
export interface JWTClaims {
  sub: string; // User ID
  tid: string; // Tenant ID
  email: string;
  roles: string[];
  permissions?: string[];
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

/**
 * Session data stored server-side.
 */
export interface Session {
  id: string;
  userId: string;
  tenantId: string;
  createdAt: Date;
  expiresAt: Date;
  lastActivityAt: Date;
  ipAddress: string;
  userAgent: string;
  mfaVerified: boolean;
}
