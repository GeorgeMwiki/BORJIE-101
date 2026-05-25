/**
 * Ambient declaration for @borjie/domain-models when package has no .d.ts
 * Remove when domain-models emits declarations
 */
declare module '@borjie/domain-models' {
  export type TenantId = string;
  export type OrganizationId = string;
  export type RoleId = string;
  export type UserId = string;
  export type PolicyId = string;
  export type SessionId = string;

  export interface User {
    id: UserId;
    tenantId: TenantId;
    type: string;
    primaryOrganizationId?: OrganizationId;
    roleAssignments: Array<{ roleId: RoleId; organizationId: OrganizationId; expiresAt?: string }>;
    security?: { mfaEnabled?: boolean };
  }

  export interface Role {
    id: RoleId;
    name: string;
    permissions: string[];
    inheritsFrom: RoleId[];
    isAdmin?: boolean;
    priority?: number;
  }

  export interface UserRoleAssignment {
    roleId: RoleId;
    organizationId: OrganizationId;
    expiresAt?: string;
  }

  export function permissionMatches(permission: string, required: string): boolean;

  export interface AuthorizationRequest {
    subject: unknown;
    action: string;
    resource: unknown;
    context?: unknown;
  }

  export interface AuthorizationDecision {
    allowed: boolean;
    reason?: string;
  }

  export interface SubjectAttributes {
    userId: string;
    tenantId?: string;
    userType?: string;
    roleIds?: string[];
    organizationIds?: string[];
    primaryOrganizationId?: string;
    permissions?: Set<string>;
    mfaVerified?: boolean;
    metadata?: Record<string, unknown>;
  }

  export interface ResourceAttributes {
    type: string;
    id?: string;
    ownerId?: string;
    tenantId?: string;
    metadata?: Record<string, unknown>;
  }

  export interface ContextAttributes {
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, unknown>;
  }

  export interface ActionAttributes {
    name: string;
    resource?: string;
    metadata?: Record<string, unknown>;
  }

  export interface PolicyCondition {
    attribute: string;
    operator: string;
    value: unknown;
  }

  export interface ConditionGroup {
    logic: 'AND' | 'OR';
    conditions: Array<PolicyCondition | ConditionGroup>;
  }

  export interface Policy {
    id: PolicyId;
    name: string;
    rules: unknown[];
  }

  export interface PolicyRule {
    id: string;
    effect: string;
    conditions?: unknown[];
  }

  export interface PolicyEvaluationResult {
    allowed: boolean;
    reason?: string;
  }

  export type PolicyEffect = 'allow' | 'deny';
  export type PolicyStatus = string;
  export type ConditionOperator = string;
  export type AttributeSource = string;

  export interface AccessTokenClaims {
    sub: string;
    email?: string;
    roles?: string[];
    permissions?: string[];
    tenantId?: string;
    iat?: number;
    exp?: number;
  }

  export interface TenantScoped {
    tenantId: TenantId;
  }

  export function asTenantId(value: string): TenantId;
  export function asUserId(value: string): UserId;
  export function asOrganizationId(value: string): OrganizationId;
  export function asRoleId(value: string): RoleId;
}
