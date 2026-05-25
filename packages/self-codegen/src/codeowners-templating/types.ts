/**
 * CODEOWNERS templating types.
 *
 * Pattern #5 from R-CODEGEN: CODEOWNERS on the policy files themselves +
 * GH required-reviewer rule = the dual-control four-eye gate.
 */

import { z } from 'zod';

export const codeownerRuleSetSchema = z.object({
  paths: z.array(z.string().min(1)).min(1),
  owners: z.array(z.string().regex(/^@[\w-]+(?:\/[\w-]+)?$/)).min(1),
});

export const codeownersConfigSchema = z.object({
  defaultOwners: z.array(z.string().regex(/^@[\w-]+(?:\/[\w-]+)?$/)).default([]),
  ruleSets: z.record(z.string(), codeownerRuleSetSchema),
});

export type CodeownerRuleSet = z.infer<typeof codeownerRuleSetSchema>;
export type CodeownersConfig = z.infer<typeof codeownersConfigSchema>;

export interface RequiredReviewerRule {
  readonly pattern: string;
  readonly minApprovals: number;
  readonly excludeUsers: readonly string[];
}

export interface RequiredReviewerRuleset {
  readonly enabled: boolean;
  readonly target: 'branch' | 'tag';
  readonly conditions: { readonly refName: { readonly include: readonly string[] } };
  readonly rules: readonly RequiredReviewerRule[];
}
