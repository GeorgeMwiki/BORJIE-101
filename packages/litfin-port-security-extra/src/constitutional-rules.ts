/**
 * Per-domain constitutional rules — fixed safety probes that the AI
 * must always pass, no matter the user request.
 *
 * LITFIN ref: src/core/governance/* — constitution.ts defines an
 * append-only list of rules. We port the rule-evaluator core and a
 * property-management-tuned starter set.
 */

import { z } from 'zod';

export const RuleSeverity = z.enum(['advisory', 'block-and-explain', 'hard-fail-closed']);
export type RuleSeverity = z.infer<typeof RuleSeverity>;

export const ConstitutionalRule = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  severity: RuleSeverity,
  /** Domain tag — `property-management`, `tenant-comm`, etc. */
  domain: z.string().min(1),
  /** Optional list of jurisdiction codes the rule applies to. */
  jurisdictions: z.array(z.string()).optional(),
});
export type ConstitutionalRule = z.infer<typeof ConstitutionalRule>;

export interface RuleEvaluationContext {
  readonly text: string;
  readonly domain: string;
  readonly jurisdiction?: string;
}

export type RuleCheck = (ctx: RuleEvaluationContext) => boolean;

export interface RuleViolation {
  readonly ruleId: string;
  readonly severity: RuleSeverity;
  readonly description: string;
}

export interface RuleEntry {
  readonly rule: ConstitutionalRule;
  readonly check: RuleCheck;
}

export const evaluate = (
  ctx: RuleEvaluationContext,
  rules: readonly RuleEntry[],
): readonly RuleViolation[] => {
  const violations: RuleViolation[] = [];
  for (const entry of rules) {
    if (entry.rule.domain !== ctx.domain && entry.rule.domain !== '*') continue;
    if (
      entry.rule.jurisdictions !== undefined &&
      ctx.jurisdiction !== undefined &&
      !entry.rule.jurisdictions.includes(ctx.jurisdiction)
    ) {
      continue;
    }
    if (entry.check(ctx)) {
      violations.push({
        ruleId: entry.rule.id,
        severity: entry.rule.severity,
        description: entry.rule.description,
      });
    }
  }
  return violations;
};

export const hasHardFail = (violations: readonly RuleViolation[]): boolean =>
  violations.some((v) => v.severity === 'hard-fail-closed');

const containsAny = (text: string, needles: readonly string[]): boolean => {
  const lower = text.toLowerCase();
  return needles.some((n) => lower.includes(n));
};

/**
 * Property-management-tuned starter rules. Caller may extend or replace.
 */
export const STARTER_RULES: readonly RuleEntry[] = [
  {
    rule: {
      id: 'PM-FAIR-HOUSING-1',
      description:
        'Must not generate or recommend tenant-screening text that uses a protected-class proxy.',
      severity: 'hard-fail-closed',
      domain: 'tenant-comm',
    },
    check: (ctx) =>
      containsAny(ctx.text, [
        'we prefer single',
        'no children',
        'no disabled',
        'no section 8',
        'whites only',
        'christians only',
      ]),
  },
  {
    rule: {
      id: 'PM-RETALIATION-1',
      description:
        'Must not draft messages that retaliate against tenants for lawful complaints.',
      severity: 'hard-fail-closed',
      domain: 'tenant-comm',
    },
    check: (ctx) =>
      containsAny(ctx.text, [
        'because you complained',
        'in retaliation for',
        'as punishment for filing',
      ]),
  },
  {
    rule: {
      id: 'PM-LOCKOUT-1',
      description: 'Must not propose self-help eviction (lockout without court order).',
      severity: 'hard-fail-closed',
      domain: 'eviction',
    },
    check: (ctx) =>
      containsAny(ctx.text, [
        'change the locks tonight',
        'shut off utilities to force',
        'remove belongings without notice',
      ]),
  },
  {
    rule: {
      id: 'PM-DEPOSIT-1',
      description:
        'Must not advise withholding the full deposit without itemised damages.',
      severity: 'block-and-explain',
      domain: 'deposit-return',
    },
    check: (ctx) =>
      containsAny(ctx.text, ['keep the entire deposit', 'no need to itemise']),
  },
  {
    rule: {
      id: 'PM-PRIVACY-1',
      description: 'Must not enter tenant unit without advance notice except emergencies.',
      severity: 'block-and-explain',
      domain: 'entry',
    },
    check: (ctx) =>
      containsAny(ctx.text, ['enter without notice', 'just walk in', 'use the master key']),
  },
];
