/**
 * `generateCounterfactual` — emit a statute-grade explanation for any
 * consequential decision, derived from tenant data only.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §5
 */

import {
  type Counterfactual,
  type CounterfactualClause,
  type DecisionEvent,
} from './types.js';

const DENIED_OUTCOMES = new Set<DecisionEvent['outcome']>(['deny', 'auto-deny']);

const DISCLAIMER =
  'This is a recommendation derived from your account data. The outcome could change if any of the failed inputs above had been within their required threshold. You retain full override authority.';

/**
 * Build one counterfactual clause per failing input.
 *
 * Pure: tenant inputs in → tenant-language clauses out. No model
 * internals, no thresholds beyond what the policy already exposes.
 */
function buildClauses(decision: DecisionEvent): CounterfactualClause[] {
  const failingInputs = decision.inputs.filter((i) => !i.passed);
  return failingInputs.map((input) => ({
    inputName: input.name,
    hypotheticalValue: input.requiredThreshold,
    hypotheticalOutcome: 'approve' as const,
  }));
}

function summarise(decision: DecisionEvent): string {
  const verb = DENIED_OUTCOMES.has(decision.outcome) ? 'recommended NOT to' : 'recommended to';
  const subjectMap: Record<DecisionEvent['kind'], string> = {
    rent_waiver: 'waive the rent / late fee',
    screening: 'approve the tenant screening',
    eviction_recommendation: 'proceed with eviction',
    deposit_deduction: 'apply the deposit deduction',
    lease_termination: 'terminate the lease',
    maintenance_priority: 'prioritise this maintenance request',
    rent_adjustment: 'adjust the rent',
  };
  return `I ${verb} ${subjectMap[decision.kind]}. Here is the full reasoning:`;
}

/**
 * Generate the counterfactual card.
 */
export function generateCounterfactual(decision: DecisionEvent): Counterfactual {
  const clauses = buildClauses(decision);
  const counterfactual: Counterfactual = Object.freeze({
    decisionId: decision.id,
    humanSummary: summarise(decision),
    policyInvoked: decision.policyInvoked,
    observed: decision.inputs,
    counterfactuals: Object.freeze(clauses),
    recoursePath: Object.freeze({
      canOverride: true,
      canRequestHumanReview: true,
      canChangeRule: DENIED_OUTCOMES.has(decision.outcome),
    }),
    disclaimer: DISCLAIMER,
  });
  return counterfactual;
}

/**
 * Render the counterfactual card to a human-readable text block for
 * inclusion in a chat reply.
 */
export function renderCounterfactual(c: Counterfactual): string {
  const lines: string[] = [];
  lines.push(c.humanSummary);
  lines.push('');
  lines.push(`**Policy invoked**: ${c.policyInvoked}`);
  lines.push('');
  lines.push('**What I looked at**:');
  for (const input of c.observed) {
    const status = input.passed ? 'PASS' : 'FAIL';
    lines.push(`  - ${input.name}: observed=${input.observedValue}, required=${input.requiredThreshold} [${status}]`);
  }
  if (c.counterfactuals.length > 0) {
    lines.push('');
    lines.push('**Counterfactual — what would have flipped my recommendation**:');
    for (const cf of c.counterfactuals) {
      lines.push(`  - If ${cf.inputName} had been ${cf.hypotheticalValue} → ${cf.hypotheticalOutcome}`);
    }
  }
  lines.push('');
  lines.push('**What you can do now**:');
  if (c.recoursePath.canOverride) lines.push('  - Override (/override)');
  if (c.recoursePath.canRequestHumanReview) lines.push('  - Request human review');
  if (c.recoursePath.canChangeRule) lines.push('  - Change your account rule for future cases');
  lines.push('');
  lines.push(c.disclaimer);
  lines.push('');
  lines.push(`Audit ID: ${c.decisionId}`);
  return lines.join('\n');
}
