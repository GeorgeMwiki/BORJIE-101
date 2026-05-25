export type Operator =
  | 'equals'
  | 'notEquals'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEquals'
  | 'lessThanOrEquals'
  | 'contains'
  | 'notContains'
  | 'in'
  | 'notIn'
  | 'startsWith'
  | 'endsWith'
  | 'matches'
  | 'exists'
  | 'notExists';

export interface Condition {
  attribute: string;
  operator: Operator;
  value: unknown;
}

export interface Rule {
  id: string;
  name: string;
  description?: string;
  effect: 'allow' | 'deny';
  priority?: number;
  conditions: Condition[];
  target?: {
    actions?: string[];
    resources?: string[];
    subjects?: string[];
  };
}

export interface Policy {
  id: string;
  name: string;
  description?: string;
  combiningAlgorithm: 'denyOverrides' | 'allowOverrides' | 'firstApplicable';
  rules: Rule[];
}

export interface EvaluationContext {
  subject: {
    id: string;
    roles: string[];
    tenantId?: string;
    propertyIds?: string[];
    [key: string]: unknown;
  };
  action: string;
  resource: {
    type: string;
    id?: string;
    ownerId?: string;
    propertyId?: string;
    tenantId?: string;
    [key: string]: unknown;
  };
  environment?: {
    timestamp?: Date;
    ipAddress?: string;
    userAgent?: string;
    [key: string]: unknown;
  };
}

export interface EvaluationResult {
  decision: 'allow' | 'deny' | 'notApplicable' | 'indeterminate';
  matchedRules: Rule[];
  reason?: string;
}

// Default ABAC policies for property management
const defaultPolicies: Policy[] = [
  {
    id: 'property-access-policy',
    name: 'Property Access Policy',
    description: 'Controls access to property resources',
    combiningAlgorithm: 'denyOverrides',
    rules: [
      {
        id: 'owner-full-access',
        name: 'Owner Full Access',
        effect: 'allow',
        priority: 100,
        conditions: [{ attribute: 'subject.roles', operator: 'contains', value: 'property-owner' }],
        target: { resources: ['property', 'unit'] },
      },
      {
        id: 'manager-property-access',
        name: 'Manager Property Access',
        effect: 'allow',
        priority: 90,
        conditions: [
          { attribute: 'subject.roles', operator: 'contains', value: 'property-manager' },
          { attribute: 'resource.propertyId', operator: 'in', value: 'subject.propertyIds' },
        ],
        target: { resources: ['property', 'unit', 'tenant', 'lease'] },
      },
      {
        id: 'tenant-own-data',
        name: 'Tenant Own Data Access',
        effect: 'allow',
        priority: 80,
        conditions: [
          { attribute: 'subject.roles', operator: 'contains', value: 'tenant' },
          { attribute: 'resource.tenantId', operator: 'equals', value: 'subject.id' },
        ],
        target: { resources: ['lease', 'payment', 'invoice'], actions: ['read'] },
      },
    ],
  },
  {
    id: 'time-based-policy',
    name: 'Time-Based Access Policy',
    description: 'Restricts certain actions to business hours',
    combiningAlgorithm: 'denyOverrides',
    rules: [
      {
        id: 'business-hours-only',
        name: 'Business Hours Only',
        effect: 'deny',
        priority: 200,
        conditions: [
          { attribute: 'environment.hour', operator: 'lessThan', value: 8 },
          { attribute: 'subject.roles', operator: 'notContains', value: 'super-admin' },
        ],
        target: { actions: ['delete'] },
      },
    ],
  },
];

export class AbacEngine {
  private policies: Policy[];

  constructor(policies: Policy[] = defaultPolicies) {
    this.policies = policies;
  }

  /**
   * Add a policy to the engine
   */
  addPolicy(policy: Policy): void {
    this.policies.push(policy);
  }

  /**
   * Remove a policy by ID
   */
  removePolicy(policyId: string): void {
    this.policies = this.policies.filter((p) => p.id !== policyId);
  }

  /**
   * Get attribute value from context using dot notation
   */
  private getAttribute(context: EvaluationContext, attribute: string): unknown {
    const parts = attribute.split('.');
    let value: unknown = context;

    for (const part of parts) {
      if (value === null || value === undefined) return undefined;
      value = (value as Record<string, unknown>)[part];
    }

    return value;
  }

  /**
   * Resolve value - could be literal or reference to context
   */
  private resolveValue(context: EvaluationContext, value: unknown): unknown {
    if (typeof value === 'string' && (value.startsWith('subject.') || value.startsWith('resource.') || value.startsWith('environment.'))) {
      return this.getAttribute(context, value);
    }
    return value;
  }

  /**
   * Evaluate a single condition
   */
  private evaluateCondition(context: EvaluationContext, condition: Condition): boolean {
    const attrValue = this.getAttribute(context, condition.attribute);
    const compareValue = this.resolveValue(context, condition.value);

    switch (condition.operator) {
      case 'equals':
        return attrValue === compareValue;

      case 'notEquals':
        return attrValue !== compareValue;

      case 'greaterThan':
        return (attrValue as number) > (compareValue as number);

      case 'lessThan':
        return (attrValue as number) < (compareValue as number);

      case 'greaterThanOrEquals':
        return (attrValue as number) >= (compareValue as number);

      case 'lessThanOrEquals':
        return (attrValue as number) <= (compareValue as number);

      case 'contains':
        if (Array.isArray(attrValue)) {
          return attrValue.includes(compareValue);
        }
        if (typeof attrValue === 'string') {
          return attrValue.includes(compareValue as string);
        }
        return false;

      case 'notContains':
        if (Array.isArray(attrValue)) {
          return !attrValue.includes(compareValue);
        }
        if (typeof attrValue === 'string') {
          return !attrValue.includes(compareValue as string);
        }
        return true;

      case 'in':
        if (Array.isArray(compareValue)) {
          return compareValue.includes(attrValue);
        }
        return false;

      case 'notIn':
        if (Array.isArray(compareValue)) {
          return !compareValue.includes(attrValue);
        }
        return true;

      case 'startsWith':
        return typeof attrValue === 'string' && attrValue.startsWith(compareValue as string);

      case 'endsWith':
        return typeof attrValue === 'string' && attrValue.endsWith(compareValue as string);

      case 'matches':
        if (typeof attrValue === 'string' && typeof compareValue === 'string') {
          const regex = new RegExp(compareValue);
          return regex.test(attrValue);
        }
        return false;

      case 'exists':
        return attrValue !== undefined && attrValue !== null;

      case 'notExists':
        return attrValue === undefined || attrValue === null;

      default:
        return false;
    }
  }

  /**
   * Check if a rule's target matches the context
   */
  private targetMatches(context: EvaluationContext, rule: Rule): boolean {
    if (!rule.target) return true;

    if (rule.target.actions && !rule.target.actions.includes(context.action)) {
      return false;
    }

    if (rule.target.resources && !rule.target.resources.includes(context.resource.type)) {
      return false;
    }

    if (rule.target.subjects) {
      const hasMatchingRole = context.subject.roles.some((role) => rule.target!.subjects!.includes(role));
      if (!hasMatchingRole) return false;
    }

    return true;
  }

  /**
   * Evaluate a single rule
   */
  private evaluateRule(context: EvaluationContext, rule: Rule): 'allow' | 'deny' | 'notApplicable' {
    // Check if target matches
    if (!this.targetMatches(context, rule)) {
      return 'notApplicable';
    }

    // Evaluate all conditions (AND logic)
    const allConditionsMet = rule.conditions.every((condition) => this.evaluateCondition(context, condition));

    if (allConditionsMet) {
      return rule.effect;
    }

    return 'notApplicable';
  }

  /**
   * Evaluate a single policy using its combining algorithm
   */
  private evaluateSinglePolicy(context: EvaluationContext, policy: Policy): EvaluationResult {
    // Sort rules by priority (higher priority first)
    const sortedRules = [...policy.rules].sort((a, b) => (b.priority || 0) - (a.priority || 0));

    const matchedRules: Rule[] = [];
    let decision: 'allow' | 'deny' | 'notApplicable' = 'notApplicable';

    switch (policy.combiningAlgorithm) {
      case 'denyOverrides':
        for (const rule of sortedRules) {
          const ruleResult = this.evaluateRule(context, rule);
          if (ruleResult === 'deny') {
            return { decision: 'deny', matchedRules: [rule], reason: `Denied by rule: ${rule.name}` };
          }
          if (ruleResult === 'allow') {
            matchedRules.push(rule);
            decision = 'allow';
          }
        }
        break;

      case 'allowOverrides':
        for (const rule of sortedRules) {
          const ruleResult = this.evaluateRule(context, rule);
          if (ruleResult === 'allow') {
            return { decision: 'allow', matchedRules: [rule], reason: `Allowed by rule: ${rule.name}` };
          }
          if (ruleResult === 'deny') {
            matchedRules.push(rule);
            decision = 'deny';
          }
        }
        break;

      case 'firstApplicable':
        for (const rule of sortedRules) {
          const ruleResult = this.evaluateRule(context, rule);
          if (ruleResult !== 'notApplicable') {
            return {
              decision: ruleResult,
              matchedRules: [rule],
              reason: `${ruleResult === 'allow' ? 'Allowed' : 'Denied'} by rule: ${rule.name}`,
            };
          }
        }
        break;
    }

    return { decision, matchedRules };
  }

  /**
   * Main evaluation method - evaluate context against all policies
   */
  evaluatePolicy(context: EvaluationContext, rules?: Rule[]): EvaluationResult {
    // Add environment timestamp if not present
    if (!context.environment) {
      context.environment = {};
    }
    if (!context.environment.timestamp) {
      context.environment.timestamp = new Date();
    }
    context.environment.hour = context.environment.timestamp.getHours();

    // If specific rules provided, create a temporary policy
    if (rules) {
      const tempPolicy: Policy = {
        id: 'temp',
        name: 'Temporary Policy',
        combiningAlgorithm: 'denyOverrides',
        rules,
      };
      return this.evaluateSinglePolicy(context, tempPolicy);
    }

    // Evaluate all policies
    const results: EvaluationResult[] = [];

    for (const policy of this.policies) {
      const result = this.evaluateSinglePolicy(context, policy);
      results.push(result);

      // Deny overrides across policies
      if (result.decision === 'deny') {
        return result;
      }
    }

    // If any policy allowed, return allow
    const allowResult = results.find((r) => r.decision === 'allow');
    if (allowResult) {
      return allowResult;
    }

    return {
      decision: 'notApplicable',
      matchedRules: [],
      reason: 'No applicable policy found',
    };
  }

  /**
   * Convenience method to check if access is allowed
   */
  isAllowed(context: EvaluationContext): boolean {
    const result = this.evaluatePolicy(context);
    return result.decision === 'allow';
  }

  /**
   * Get all registered policies
   */
  getPolicies(): Policy[] {
    return [...this.policies];
  }
}

export const abacEngine = new AbacEngine();
