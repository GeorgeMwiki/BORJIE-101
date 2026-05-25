/**
 * Approval matrix DSL evaluator.
 *
 * Given a runtime `ActionStep` and a set of `CompiledRule` rows (loaded
 * from `approval_matrix_dsl_compiled`), return the set of required
 * approvers (role-group + quorum) — and optionally a pre-notify
 * role-group.
 *
 * Resolution order:
 *   1. Filter rules to active=true and tenant_id ∈ {step.tenantId, NULL}.
 *   2. Filter rules whose `predicate` matches the step.
 *   3. Sort by priority DESC.
 *   4. The HIGHEST-priority matching rule wins. Lower-priority matches
 *      are recorded as `additionalMatches` for audit transparency.
 *
 * One match → one required role-group. The caller still has to drive
 * the K5 approval quorum collection — this evaluator only DECIDES who
 * is required.
 */

import {
  type AmountOp,
  type CompiledPredicate,
  type CompiledRule,
} from './grammar.js';

export interface EvaluationActionStep {
  readonly tenantId: string;
  readonly module?: string;
  readonly stepKind: string;
  readonly currency?: string;
  /** Amount in micro-units of the named currency. */
  readonly amountMicros?: number;
  readonly attributes?: Readonly<Record<string, unknown>>;
  /** Actor's persona power tier (1=OWNER … 5=CUSTOMER). */
  readonly actorPersonaTier?: 1 | 2 | 3 | 4 | 5;
}

export interface EvaluationResult {
  readonly requiredRoleGroup: string;
  readonly quorum: number;
  readonly notifyRoleGroup: string | null;
  readonly winningRuleSlug: string;
  readonly winningRuleId: string;
  readonly additionalMatches: ReadonlyArray<{
    readonly ruleSlug: string;
    readonly ruleId: string;
    readonly priority: number;
  }>;
}

export interface NoMatchResult {
  readonly requiredRoleGroup: null;
  readonly reason: 'no_matching_rule';
}

export type EvaluatorOutcome = EvaluationResult | NoMatchResult;

// ─────────────────────────────────────────────────────────────────────
// Predicate matchers
// ─────────────────────────────────────────────────────────────────────

function amountSatisfies(
  op: AmountOp,
  actualMicros: number,
  ruleMicros: number,
): boolean {
  switch (op) {
    case '<':
      return actualMicros < ruleMicros;
    case '<=':
      return actualMicros <= ruleMicros;
    case '>':
      return actualMicros > ruleMicros;
    case '>=':
      return actualMicros >= ruleMicros;
    case '==':
      return actualMicros === ruleMicros;
    case '!=':
      return actualMicros !== ruleMicros;
    default:
      return false;
  }
}

function attributeMatches(
  ruleValue: unknown,
  actualValue: unknown,
): boolean {
  if (
    ruleValue !== null &&
    typeof ruleValue === 'object' &&
    '__prefix__' in (ruleValue as Record<string, unknown>)
  ) {
    const prefix = (ruleValue as { readonly __prefix__: string }).__prefix__;
    return typeof actualValue === 'string' && actualValue.startsWith(prefix);
  }
  // Strict equality for primitive matchers.
  return ruleValue === actualValue;
}

function predicateMatches(
  predicate: CompiledPredicate,
  step: EvaluationActionStep,
): boolean {
  if (predicate.module !== undefined && predicate.module !== step.module) {
    return false;
  }
  if (predicate.stepKind !== undefined && predicate.stepKind !== step.stepKind) {
    return false;
  }
  if (
    predicate.currency !== undefined &&
    predicate.currency !== step.currency
  ) {
    return false;
  }
  if (predicate.amountCmp !== undefined) {
    if (step.amountMicros === undefined) {
      return false;
    }
    if (
      !amountSatisfies(
        predicate.amountCmp.op,
        step.amountMicros,
        predicate.amountCmp.valueMicros,
      )
    ) {
      return false;
    }
  }
  if (
    predicate.actorPersonaTier !== undefined &&
    predicate.actorPersonaTier !== step.actorPersonaTier
  ) {
    return false;
  }
  if (predicate.attributes !== undefined) {
    const actualAttrs = step.attributes ?? {};
    for (const [key, ruleValue] of Object.entries(predicate.attributes)) {
      const actualValue = actualAttrs[key];
      if (!attributeMatches(ruleValue, actualValue)) {
        return false;
      }
    }
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────
// Top-level evaluator
// ─────────────────────────────────────────────────────────────────────

export function evaluate(
  step: EvaluationActionStep,
  rules: ReadonlyArray<CompiledRule>,
): EvaluatorOutcome {
  const matched = rules
    .filter(
      (r) =>
        r.active &&
        (r.tenantId === null || r.tenantId === step.tenantId) &&
        predicateMatches(r.predicate, step),
    )
    .sort((a, b) => b.priority - a.priority);

  if (matched.length === 0) {
    return { requiredRoleGroup: null, reason: 'no_matching_rule' };
  }

  const [winner, ...rest] = matched;
  if (!winner) {
    return { requiredRoleGroup: null, reason: 'no_matching_rule' };
  }

  return {
    requiredRoleGroup: winner.requiredRoleGroup,
    quorum: winner.quorum,
    notifyRoleGroup: winner.notifyRoleGroup,
    winningRuleSlug: winner.ruleSlug,
    winningRuleId: winner.id,
    additionalMatches: rest.map((r) => ({
      ruleSlug: r.ruleSlug,
      ruleId: r.id,
      priority: r.priority,
    })),
  };
}
