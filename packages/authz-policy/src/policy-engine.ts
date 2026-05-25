/**
 * Policy evaluation engine.
 *
 * Implements RBAC+ABAC authorization with tenant isolation.
 */

import {
  AuthContext,
  AuthDecision,
  BulkAuthDecision,
  Policy,
  PolicyCondition,
  PolicyEngineConfig,
  PolicyPermission,
  defaultPolicyEngineConfig,
  Action,
  Resource,
} from './types.js';

// ============================================================================
// Policy Engine
// ============================================================================

export class PolicyEngine {
  private policies: Policy[] = [];
  private config: PolicyEngineConfig;
  private cache: Map<string, { decision: AuthDecision; expiresAt: number }> = new Map();

  constructor(config: Partial<PolicyEngineConfig> = {}) {
    this.config = { ...defaultPolicyEngineConfig, ...config };
  }

  /**
   * Register policies with the engine.
   */
  registerPolicies(policies: Policy[]): void {
    this.policies = [...this.policies, ...policies].sort((a, b) => b.priority - a.priority);
    this.clearCache();
  }

  /**
   * Clear all registered policies.
   */
  clearPolicies(): void {
    this.policies = [];
    this.clearCache();
  }

  /**
   * Clear the evaluation cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Evaluate an authorization request.
   */
  evaluate(context: AuthContext): AuthDecision {
    const startTime = performance.now();

    // Check cache first
    if (this.config.enableCache) {
      const cacheKey = this.getCacheKey(context);
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return { ...cached.decision, evaluationTime: performance.now() - startTime };
      }
    }

    // Enforce tenant isolation
    if (this.config.enforceTenantIsolation) {
      const tenantCheck = this.checkTenantIsolation(context);
      if (!tenantCheck.allowed) {
        return this.finalizeDecision(tenantCheck, context, startTime);
      }
    }

    // Evaluate policies
    let decision: AuthDecision = {
      allowed: this.config.defaultDecision === 'allow',
      reason: 'No matching policy found',
    };

    for (const policy of this.policies) {
      const match = this.evaluatePolicy(policy, context);
      if (match !== null) {
        decision = {
          allowed: policy.effect === 'allow',
          reason: `Matched policy: ${policy.name}`,
          matchedPolicy: policy.id,
        };
        break;
      }
    }

    return this.finalizeDecision(decision, context, startTime);
  }

  /**
   * Evaluate multiple authorization requests efficiently.
   */
  evaluateBulk(contexts: AuthContext[]): BulkAuthDecision {
    const startTime = performance.now();
    const results = new Map<string, AuthDecision>();

    for (const context of contexts) {
      const key = `${context.action}:${context.object.resource}:${context.object.id || '*'}`;
      results.set(key, this.evaluate(context));
    }

    return {
      results,
      evaluationTime: performance.now() - startTime,
    };
  }

  /**
   * Check if a user can perform an action on a resource.
   * Convenience method for simple authorization checks.
   */
  can(
    subject: AuthContext['subject'],
    action: Action,
    resource: Resource,
    resourceId?: string,
    attributes?: Record<string, unknown>
  ): boolean {
    const decision = this.evaluate({
      subject,
      action,
      object: {
        resource,
        id: resourceId,
        tenantId: subject.tenantId,
        attributes,
      },
    });
    return decision.allowed;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private checkTenantIsolation(context: AuthContext): AuthDecision {
    const { subject, object } = context;

    // If the object has a tenant ID, it must match the subject's tenant
    if (object.tenantId && object.tenantId !== subject.tenantId) {
      return {
        allowed: false,
        reason: 'Tenant isolation violation: cross-tenant access denied',
      };
    }

    return { allowed: true };
  }

  private evaluatePolicy(policy: Policy, context: AuthContext): boolean | null {
    for (const permission of policy.permissions) {
      if (this.matchesPermission(permission, context)) {
        return true;
      }
    }
    return null;
  }

  private matchesPermission(permission: PolicyPermission, context: AuthContext): boolean {
    // Check resource match
    if (permission.resource !== context.object.resource) {
      return false;
    }

    // Check action match
    if (!permission.actions.includes(context.action) && !permission.actions.includes('manage')) {
      return false;
    }

    // Check conditions
    if (permission.conditions && permission.conditions.length > 0) {
      return this.evaluateConditions(permission.conditions, context);
    }

    return true;
  }

  private evaluateConditions(conditions: PolicyCondition[], context: AuthContext): boolean {
    return conditions.every((condition) => this.evaluateCondition(condition, context));
  }

  private evaluateCondition(condition: PolicyCondition, context: AuthContext): boolean {
    const fieldValue = this.resolveFieldValue(condition.field, context);
    const conditionValue = condition.value;

    switch (condition.operator) {
      case 'eq':
        return fieldValue === conditionValue;
      case 'neq':
        return fieldValue !== conditionValue;
      case 'in':
        return Array.isArray(conditionValue) && conditionValue.includes(fieldValue);
      case 'nin':
        return Array.isArray(conditionValue) && !conditionValue.includes(fieldValue);
      case 'gt':
        return typeof fieldValue === 'number' && fieldValue > (conditionValue as number);
      case 'gte':
        return typeof fieldValue === 'number' && fieldValue >= (conditionValue as number);
      case 'lt':
        return typeof fieldValue === 'number' && fieldValue < (conditionValue as number);
      case 'lte':
        return typeof fieldValue === 'number' && fieldValue <= (conditionValue as number);
      case 'contains':
        return (
          typeof fieldValue === 'string' &&
          typeof conditionValue === 'string' &&
          fieldValue.includes(conditionValue)
        );
      case 'starts_with':
        return (
          typeof fieldValue === 'string' &&
          typeof conditionValue === 'string' &&
          fieldValue.startsWith(conditionValue)
        );
      case 'ends_with':
        return (
          typeof fieldValue === 'string' &&
          typeof conditionValue === 'string' &&
          fieldValue.endsWith(conditionValue)
        );
      case 'exists':
        return conditionValue ? fieldValue !== undefined : fieldValue === undefined;
      default:
        return false;
    }
  }

  private resolveFieldValue(field: string, context: AuthContext): unknown {
    const parts = field.split('.');
    let value: unknown = context;

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = (value as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  private getCacheKey(context: AuthContext): string {
    return `${context.subject.userId}:${context.action}:${context.object.resource}:${context.object.id || '*'}`;
  }

  private finalizeDecision(
    decision: AuthDecision,
    context: AuthContext,
    startTime: number
  ): AuthDecision {
    const finalDecision = {
      ...decision,
      evaluationTime: performance.now() - startTime,
    };

    // Cache the decision
    if (this.config.enableCache) {
      const cacheKey = this.getCacheKey(context);
      this.cache.set(cacheKey, {
        decision: finalDecision,
        expiresAt: Date.now() + this.config.cacheTtlMs,
      });
    }

    return finalDecision;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let defaultEngine: PolicyEngine | null = null;

/**
 * Get the default policy engine instance.
 */
export function getPolicyEngine(): PolicyEngine {
  if (!defaultEngine) {
    defaultEngine = new PolicyEngine();
  }
  return defaultEngine;
}

/**
 * Reset the default policy engine (useful for testing).
 */
export function resetPolicyEngine(): void {
  defaultEngine = null;
}
