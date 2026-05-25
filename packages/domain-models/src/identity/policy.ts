/**
 * Policy Domain Model
 * 
 * Policies implement Attribute-Based Access Control (ABAC) for fine-grained
 * authorization decisions beyond simple RBAC permissions.
 */

import type {
  TenantId,
  PolicyId,
  UserId,
  RoleId,
  OrganizationId,
  EntityMetadata,
  SoftDeletable,
  TenantScoped,
} from '../common/types.js';

/** Policy effect (allow or deny) */
export const PolicyEffect = {
  ALLOW: 'ALLOW',
  DENY: 'DENY',
} as const;

export type PolicyEffect = (typeof PolicyEffect)[keyof typeof PolicyEffect];

/** Policy status */
export const PolicyStatus = {
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
  ARCHIVED: 'ARCHIVED',
} as const;

export type PolicyStatus = (typeof PolicyStatus)[keyof typeof PolicyStatus];

/** Condition operator types */
export const ConditionOperator = {
  EQUALS: 'eq',
  NOT_EQUALS: 'neq',
  GREATER_THAN: 'gt',
  GREATER_THAN_OR_EQUALS: 'gte',
  LESS_THAN: 'lt',
  LESS_THAN_OR_EQUALS: 'lte',
  IN: 'in',
  NOT_IN: 'nin',
  CONTAINS: 'contains',
  NOT_CONTAINS: 'ncontains',
  STARTS_WITH: 'starts',
  ENDS_WITH: 'ends',
  MATCHES: 'matches',
  EXISTS: 'exists',
  IS_OWNER: 'is_owner',
  IN_ORG_HIERARCHY: 'in_org_hierarchy',
  TIME_BETWEEN: 'time_between',
  IP_IN_RANGE: 'ip_in_range',
} as const;

export type ConditionOperator = (typeof ConditionOperator)[keyof typeof ConditionOperator];

/** Attribute source for conditions */
export const AttributeSource = {
  /** Attributes from the authenticated subject (user) */
  SUBJECT: 'subject',
  /** Attributes from the resource being accessed */
  RESOURCE: 'resource',
  /** Attributes from the request context (IP, time, etc) */
  CONTEXT: 'context',
  /** Attributes from the action being performed */
  ACTION: 'action',
} as const;

export type AttributeSource = (typeof AttributeSource)[keyof typeof AttributeSource];

/** A single condition in a policy rule */
export interface PolicyCondition {
  /** Attribute source */
  readonly source: AttributeSource;
  /** Attribute path (dot notation for nested) */
  readonly attribute: string;
  /** Comparison operator */
  readonly operator: ConditionOperator;
  /** Value to compare against */
  readonly value: unknown;
}

/** Logical grouping of conditions */
export interface ConditionGroup {
  /** Logical operator for combining conditions */
  readonly logic: 'AND' | 'OR';
  /** Conditions in this group */
  readonly conditions: readonly (PolicyCondition | ConditionGroup)[];
}

/** Policy rule defines when a policy applies */
export interface PolicyRule {
  /** Actions this rule applies to (e.g., ["read", "list"]) */
  readonly actions: readonly string[];
  /** Resources this rule applies to (e.g., ["property", "unit"]) */
  readonly resources: readonly string[];
  /** Conditions that must be met */
  readonly conditions: ConditionGroup | null;
  /** Effect if rule matches */
  readonly effect: PolicyEffect;
}

/** Core Policy entity */
export interface Policy extends EntityMetadata, SoftDeletable, TenantScoped {
  readonly id: PolicyId;
  /** Policy name (unique within tenant) */
  readonly name: string;
  /** Human-readable description */
  readonly description: string;
  /** Current status */
  readonly status: PolicyStatus;
  /** Priority for evaluation order (higher = evaluated first) */
  readonly priority: number;
  /** Policy rules */
  readonly rules: readonly PolicyRule[];
  /** Target principals (users, roles) - empty means all */
  readonly targetPrincipals: PolicyTargets;
  /** Target organizations - empty means all in tenant */
  readonly targetOrganizations: readonly OrganizationId[];
  /** Whether this is a system policy (cannot be modified) */
  readonly isSystem: boolean;
}

/** Policy target principals */
export interface PolicyTargets {
  /** Specific user IDs */
  readonly userIds: readonly UserId[];
  /** Role IDs (applies to users with these roles) */
  readonly roleIds: readonly RoleId[];
  /** User types */
  readonly userTypes: readonly string[];
}

/** Input for creating a policy */
export interface CreatePolicyInput {
  readonly name: string;
  readonly description: string;
  readonly priority?: number;
  readonly rules: readonly PolicyRule[];
  readonly targetPrincipals?: Partial<PolicyTargets>;
  readonly targetOrganizations?: readonly OrganizationId[];
}

/** Input for updating a policy */
export interface UpdatePolicyInput {
  readonly name?: string;
  readonly description?: string;
  readonly status?: PolicyStatus;
  readonly priority?: number;
  readonly rules?: readonly PolicyRule[];
  readonly targetPrincipals?: Partial<PolicyTargets>;
  readonly targetOrganizations?: readonly OrganizationId[];
}

/** Authorization request for policy evaluation */
export interface AuthorizationRequest {
  /** Subject attributes (user making the request) */
  readonly subject: SubjectAttributes;
  /** Action being requested */
  readonly action: ActionAttributes;
  /** Resource being accessed */
  readonly resource: ResourceAttributes;
  /** Request context */
  readonly context: ContextAttributes;
}

/** Subject (user) attributes for authorization */
export interface SubjectAttributes {
  readonly userId: UserId;
  readonly tenantId: TenantId;
  readonly userType: string;
  readonly roleIds: readonly RoleId[];
  readonly organizationIds: readonly OrganizationId[];
  readonly primaryOrganizationId: OrganizationId;
  readonly permissions: readonly string[];
  readonly mfaVerified: boolean;
  readonly metadata: Record<string, unknown>;
}

/** Action attributes for authorization */
export interface ActionAttributes {
  readonly name: string;
  readonly resource: string;
  readonly metadata: Record<string, unknown>;
}

/** Resource attributes for authorization */
export interface ResourceAttributes {
  readonly type: string;
  readonly id: string | null;
  readonly tenantId: TenantId;
  readonly organizationId: OrganizationId | null;
  readonly ownerId: UserId | null;
  readonly metadata: Record<string, unknown>;
}

/** Context attributes for authorization */
export interface ContextAttributes {
  readonly ipAddress: string;
  readonly userAgent: string;
  readonly timestamp: string;
  readonly requestId: string;
  readonly sessionId: string | null;
  readonly metadata: Record<string, unknown>;
}

/** Authorization decision result */
export interface AuthorizationDecision {
  /** Whether access is allowed */
  readonly allowed: boolean;
  /** Reason for the decision */
  readonly reason: string;
  /** Policy that made the decision (if any) */
  readonly decidingPolicyId: PolicyId | null;
  /** Rule index within the policy */
  readonly decidingRuleIndex: number | null;
  /** All evaluated policies with their results */
  readonly evaluationTrace: readonly PolicyEvaluationResult[];
}

/** Result of evaluating a single policy */
export interface PolicyEvaluationResult {
  readonly policyId: PolicyId;
  readonly policyName: string;
  readonly matched: boolean;
  readonly effect: PolicyEffect | null;
  readonly matchedRuleIndex: number | null;
  readonly evaluationTimeMs: number;
}

/** Check if a policy is active and can be evaluated */
export function isPolicyActive(policy: Policy): boolean {
  return policy.status === PolicyStatus.ACTIVE && policy.deletedAt === null;
}

/** Check if a policy targets a specific user */
export function policyTargetsUser(
  policy: Policy,
  userId: UserId,
  userType: string,
  userRoleIds: readonly RoleId[]
): boolean {
  const { targetPrincipals } = policy;
  
  // If no targets specified, policy applies to all
  if (
    targetPrincipals.userIds.length === 0 &&
    targetPrincipals.roleIds.length === 0 &&
    targetPrincipals.userTypes.length === 0
  ) {
    return true;
  }
  
  // Check specific user ID
  if (targetPrincipals.userIds.includes(userId)) {
    return true;
  }
  
  // Check user type
  if (targetPrincipals.userTypes.includes(userType)) {
    return true;
  }
  
  // Check role IDs
  for (const roleId of userRoleIds) {
    if (targetPrincipals.roleIds.includes(roleId)) {
      return true;
    }
  }
  
  return false;
}

/** Check if a policy targets a specific organization */
export function policyTargetsOrganization(
  policy: Policy,
  organizationId: OrganizationId
): boolean {
  // If no target orgs specified, policy applies to all
  if (policy.targetOrganizations.length === 0) {
    return true;
  }
  
  return policy.targetOrganizations.includes(organizationId);
}

/** System policy definitions */
export const SYSTEM_POLICIES = {
  /** Tenant isolation - users can only access resources in their tenant */
  TENANT_ISOLATION: {
    name: 'Tenant Isolation',
    description: 'Enforces tenant boundary - users can only access resources in their own tenant',
    priority: 10000,
    isSystem: true,
    rules: [
      {
        actions: ['*'],
        resources: ['*'],
        conditions: {
          logic: 'AND' as const,
          conditions: [
            {
              source: AttributeSource.SUBJECT,
              attribute: 'tenantId',
              operator: ConditionOperator.NOT_EQUALS,
              value: { ref: 'resource.tenantId' },
            },
          ],
        },
        effect: PolicyEffect.DENY,
      },
    ],
  },
  /** Users can only manage resources in their organization hierarchy */
  ORG_HIERARCHY: {
    name: 'Organization Hierarchy',
    description: 'Users can only access resources in their organization or descendants',
    priority: 9000,
    isSystem: true,
    rules: [
      {
        actions: ['*'],
        resources: ['*'],
        conditions: {
          logic: 'AND' as const,
          conditions: [
            {
              source: AttributeSource.RESOURCE,
              attribute: 'organizationId',
              operator: ConditionOperator.EXISTS,
              value: true,
            },
            {
              source: AttributeSource.SUBJECT,
              attribute: 'organizationIds',
              operator: ConditionOperator.NOT_IN,
              value: { ref: 'resource.organizationId' },
            },
          ],
        },
        effect: PolicyEffect.DENY,
      },
    ],
  },
  /** Customers can only access their own resources */
  CUSTOMER_OWN_RESOURCES: {
    name: 'Customer Own Resources',
    description: 'Customers can only access resources they own',
    priority: 8000,
    isSystem: true,
    rules: [
      {
        actions: ['read', 'update', 'list'],
        resources: ['lease', 'payment', 'maintenance', 'document'],
        conditions: {
          logic: 'AND' as const,
          conditions: [
            {
              source: AttributeSource.SUBJECT,
              attribute: 'userType',
              operator: ConditionOperator.EQUALS,
              value: 'CUSTOMER',
            },
            {
              source: AttributeSource.SUBJECT,
              attribute: 'userId',
              operator: ConditionOperator.NOT_EQUALS,
              value: { ref: 'resource.ownerId' },
            },
          ],
        },
        effect: PolicyEffect.DENY,
      },
    ],
  },
} as const;
