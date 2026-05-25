// @ts-nocheck — schema drift between domain-models Policy type and authz-policy; tracked for rewrite
/**
 * Policy Evaluator
 * 
 * Evaluates ABAC policies against authorization requests to make access decisions.
 * Implements a deny-first evaluation strategy with detailed decision tracing.
 */

import {
  PolicyEffect,
  PolicyStatus,
  ConditionOperator,
  AttributeSource,
} from '@borjie/domain-models';
import type {
  TenantId,
  PolicyId,
  OrganizationId,
  Policy,
  PolicyRule,
  PolicyCondition,
  ConditionGroup,
  AuthorizationRequest,
  AuthorizationDecision,
  PolicyEvaluationResult,
  SubjectAttributes,
  ResourceAttributes,
  ContextAttributes,
  ActionAttributes,
} from '@borjie/domain-models';

/** Policy store interface for dependency injection */
export interface PolicyStore {
  getActivePolicies(tenantId: TenantId): Promise<readonly Policy[]>;
  getPolicy(policyId: PolicyId, tenantId: TenantId): Promise<Policy | null>;
}

/** Policy evaluator configuration */
export interface PolicyEvaluatorConfig {
  /** Enable detailed evaluation tracing */
  enableTracing: boolean;
  /** Default decision when no policies match */
  defaultDecision: boolean;
  /** Maximum evaluation time per policy (ms) */
  maxEvaluationTimeMs: number;
}

const DEFAULT_CONFIG: PolicyEvaluatorConfig = {
  enableTracing: true,
  defaultDecision: false, // Deny by default
  maxEvaluationTimeMs: 100,
};

/**
 * Evaluates ABAC policies to make authorization decisions.
 */
export class PolicyEvaluator {
  private readonly config: PolicyEvaluatorConfig;
  private readonly policyStore: PolicyStore;
  
  constructor(policyStore: PolicyStore, config?: Partial<PolicyEvaluatorConfig>) {
    this.policyStore = policyStore;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Evaluate all applicable policies for an authorization request.
   */
  async evaluate(request: AuthorizationRequest): Promise<AuthorizationDecision> {
    const startTime = performance.now();
    const evaluationTrace: PolicyEvaluationResult[] = [];
    
    // Get all active policies for the tenant
    const policies = await this.policyStore.getActivePolicies(request.subject.tenantId);
    
    // Sort by priority (higher first)
    const sortedPolicies = [...policies].sort((a, b) => b.priority - a.priority);
    
    let decidingPolicy: Policy | null = null;
    let decidingRuleIndex: number | null = null;
    let decision: PolicyEffect | null = null;
    
    for (const policy of sortedPolicies) {
      const evalStart = performance.now();
      const result = this.evaluatePolicy(policy, request);
      const evalTime = performance.now() - evalStart;
      
      if (this.config.enableTracing) {
        evaluationTrace.push({
          policyId: policy.id,
          policyName: policy.name,
          matched: result.matched,
          effect: result.effect,
          matchedRuleIndex: result.ruleIndex,
          evaluationTimeMs: evalTime,
        });
      }
      
      // First matching policy with DENY effect wins immediately
      if (result.matched && result.effect === PolicyEffect.DENY) {
        decidingPolicy = policy;
        decidingRuleIndex = result.ruleIndex;
        decision = PolicyEffect.DENY;
        break;
      }
      
      // Track first ALLOW decision
      if (result.matched && result.effect === PolicyEffect.ALLOW && !decidingPolicy) {
        decidingPolicy = policy;
        decidingRuleIndex = result.ruleIndex;
        decision = PolicyEffect.ALLOW;
        // Continue checking for DENY policies
      }
    }
    
    const totalTime = performance.now() - startTime;
    const allowed = decision === PolicyEffect.ALLOW || 
                    (decision === null && this.config.defaultDecision);
    
    return {
      allowed,
      reason: this.buildDecisionReason(decidingPolicy, decision, allowed),
      decidingPolicyId: decidingPolicy?.id ?? null,
      decidingRuleIndex,
      evaluationTrace,
    };
  }
  
  /**
   * Evaluate a single policy against a request.
   */
  private evaluatePolicy(
    policy: Policy,
    request: AuthorizationRequest
  ): { matched: boolean; effect: PolicyEffect | null; ruleIndex: number | null } {
    // Check if policy targets this principal
    if (!this.policyTargetsPrincipal(policy, request.subject)) {
      return { matched: false, effect: null, ruleIndex: null };
    }
    
    // Check if policy targets the resource's organization
    if (request.resource.organizationId) {
      if (!this.policyTargetsOrganization(policy, request.resource.organizationId)) {
        return { matched: false, effect: null, ruleIndex: null };
      }
    }
    
    // Evaluate each rule
    for (let i = 0; i < policy.rules.length; i++) {
      const rule = policy.rules[i];
      if (!rule) continue;
      
      if (this.evaluateRule(rule, request)) {
        return { matched: true, effect: rule.effect, ruleIndex: i };
      }
    }
    
    return { matched: false, effect: null, ruleIndex: null };
  }
  
  /**
   * Evaluate a single rule against a request.
   */
  private evaluateRule(rule: PolicyRule, request: AuthorizationRequest): boolean {
    // Check if rule applies to this action
    if (!this.matchesActions(rule.actions, request.action.name)) {
      return false;
    }
    
    // Check if rule applies to this resource type
    if (!this.matchesResources(rule.resources, request.resource.type)) {
      return false;
    }
    
    // Evaluate conditions if present
    if (rule.conditions) {
      return this.evaluateConditionGroup(rule.conditions, request);
    }
    
    // No conditions means rule matches
    return true;
  }
  
  /**
   * Evaluate a condition group (AND/OR).
   */
  private evaluateConditionGroup(
    group: ConditionGroup,
    request: AuthorizationRequest
  ): boolean {
    if (group.logic === 'AND') {
      return group.conditions.every((c: PolicyCondition | ConditionGroup) => this.evaluateConditionOrGroup(c, request));
    } else {
      return group.conditions.some((c: PolicyCondition | ConditionGroup) => this.evaluateConditionOrGroup(c, request));
    }
  }
  
  /**
   * Evaluate a condition or nested group.
   */
  private evaluateConditionOrGroup(
    condition: PolicyCondition | ConditionGroup,
    request: AuthorizationRequest
  ): boolean {
    if ('logic' in condition) {
      return this.evaluateConditionGroup(condition, request);
    }
    return this.evaluateCondition(condition, request);
  }
  
  /**
   * Evaluate a single condition.
   */
  private evaluateCondition(
    condition: PolicyCondition,
    request: AuthorizationRequest
  ): boolean {
    // Get the attribute value from the appropriate source
    const sourceValue = this.getAttributeValue(
      condition.source,
      condition.attribute,
      request
    );
    
    // Resolve the comparison value (may be a reference)
    const comparisonValue = this.resolveValue(condition.value, request);
    
    // Apply the operator
    return this.applyOperator(condition.operator, sourceValue, comparisonValue);
  }
  
  /**
   * Get an attribute value from the request based on source.
   */
  private getAttributeValue(
    source: AttributeSource,
    attribute: string,
    request: AuthorizationRequest
  ): unknown {
    let obj: Record<string, unknown>;
    
    switch (source) {
      case AttributeSource.SUBJECT:
        obj = request.subject as unknown as Record<string, unknown>;
        break;
      case AttributeSource.RESOURCE:
        obj = request.resource as unknown as Record<string, unknown>;
        break;
      case AttributeSource.CONTEXT:
        obj = request.context as unknown as Record<string, unknown>;
        break;
      case AttributeSource.ACTION:
        obj = request.action as unknown as Record<string, unknown>;
        break;
      default:
        return undefined;
    }
    
    return this.getNestedValue(obj, attribute);
  }
  
  /**
   * Get a nested value using dot notation.
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    
    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    
    return current;
  }
  
  /**
   * Resolve a value that may be a reference to another attribute.
   */
  private resolveValue(value: unknown, request: AuthorizationRequest): unknown {
    if (value && typeof value === 'object' && 'ref' in value) {
      const ref = (value as { ref: string }).ref;
      const [source, ...pathParts] = ref.split('.');
      const path = pathParts.join('.');
      return this.getAttributeValue(source as AttributeSource, path, request);
    }
    return value;
  }
  
  /**
   * Apply a comparison operator.
   */
  private applyOperator(
    operator: ConditionOperator,
    sourceValue: unknown,
    comparisonValue: unknown
  ): boolean {
    switch (operator) {
      case ConditionOperator.EQUALS:
        return sourceValue === comparisonValue;
        
      case ConditionOperator.NOT_EQUALS:
        return sourceValue !== comparisonValue;
        
      case ConditionOperator.GREATER_THAN:
        return Number(sourceValue) > Number(comparisonValue);
        
      case ConditionOperator.GREATER_THAN_OR_EQUALS:
        return Number(sourceValue) >= Number(comparisonValue);
        
      case ConditionOperator.LESS_THAN:
        return Number(sourceValue) < Number(comparisonValue);
        
      case ConditionOperator.LESS_THAN_OR_EQUALS:
        return Number(sourceValue) <= Number(comparisonValue);
        
      case ConditionOperator.IN:
        if (Array.isArray(comparisonValue)) {
          return comparisonValue.includes(sourceValue);
        }
        return false;
        
      case ConditionOperator.NOT_IN:
        if (Array.isArray(comparisonValue)) {
          return !comparisonValue.includes(sourceValue);
        }
        return true;
        
      case ConditionOperator.CONTAINS:
        if (typeof sourceValue === 'string' && typeof comparisonValue === 'string') {
          return sourceValue.includes(comparisonValue);
        }
        if (Array.isArray(sourceValue)) {
          return sourceValue.includes(comparisonValue);
        }
        return false;
        
      case ConditionOperator.NOT_CONTAINS:
        if (typeof sourceValue === 'string' && typeof comparisonValue === 'string') {
          return !sourceValue.includes(comparisonValue);
        }
        if (Array.isArray(sourceValue)) {
          return !sourceValue.includes(comparisonValue);
        }
        return true;
        
      case ConditionOperator.STARTS_WITH:
        if (typeof sourceValue === 'string' && typeof comparisonValue === 'string') {
          return sourceValue.startsWith(comparisonValue);
        }
        return false;
        
      case ConditionOperator.ENDS_WITH:
        if (typeof sourceValue === 'string' && typeof comparisonValue === 'string') {
          return sourceValue.endsWith(comparisonValue);
        }
        return false;
        
      case ConditionOperator.MATCHES:
        if (typeof sourceValue === 'string' && typeof comparisonValue === 'string') {
          try {
            return new RegExp(comparisonValue).test(sourceValue);
          } catch {
            return false;
          }
        }
        return false;
        
      case ConditionOperator.EXISTS:
        return comparisonValue ? sourceValue !== undefined : sourceValue === undefined;
        
      case ConditionOperator.IS_OWNER:
        // Special operator: check if subject is owner of resource
        return sourceValue === comparisonValue;
        
      case ConditionOperator.IN_ORG_HIERARCHY:
        // Special operator: check if org is in hierarchy
        // This would typically require looking up org paths
        if (Array.isArray(sourceValue) && typeof comparisonValue === 'string') {
          return sourceValue.includes(comparisonValue);
        }
        return false;
        
      default:
        return false;
    }
  }
  
  /**
   * Check if action matches rule actions.
   */
  private matchesActions(ruleActions: readonly string[], action: string): boolean {
    return ruleActions.some((a) => a === '*' || a === action);
  }
  
  /**
   * Check if resource type matches rule resources.
   */
  private matchesResources(ruleResources: readonly string[], resourceType: string): boolean {
    return ruleResources.some((r) => r === '*' || r === resourceType);
  }
  
  /**
   * Check if policy targets the given principal.
   */
  private policyTargetsPrincipal(policy: Policy, subject: SubjectAttributes): boolean {
    const { targetPrincipals } = policy;
    
    // Empty targets = applies to all
    if (
      targetPrincipals.userIds.length === 0 &&
      targetPrincipals.roleIds.length === 0 &&
      targetPrincipals.userTypes.length === 0
    ) {
      return true;
    }
    
    // Check specific user
    if (targetPrincipals.userIds.includes(subject.userId)) {
      return true;
    }
    
    // Check user type
    if (targetPrincipals.userTypes.includes(subject.userType)) {
      return true;
    }
    
    // Check roles
    for (const roleId of subject.roleIds) {
      if (targetPrincipals.roleIds.includes(roleId)) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Check if policy targets the given organization.
   */
  private policyTargetsOrganization(policy: Policy, orgId: OrganizationId): boolean {
    if (policy.targetOrganizations.length === 0) {
      return true;
    }
    return policy.targetOrganizations.includes(orgId);
  }
  
  /**
   * Build a human-readable decision reason.
   */
  private buildDecisionReason(
    policy: Policy | null,
    effect: PolicyEffect | null,
    allowed: boolean
  ): string {
    if (!policy) {
      return allowed
        ? 'No policies denied access; default allow'
        : 'No policies allowed access; default deny';
    }
    
    return `${effect === PolicyEffect.ALLOW ? 'Allowed' : 'Denied'} by policy "${policy.name}"`;
  }
}
