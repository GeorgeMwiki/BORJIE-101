/**
 * Approval matrix DSL grammar — Zod schemas for the compiled predicate.
 *
 * The DSL surface (human-authored) looks like:
 *
 *   RULE 'estate_rent_below_500k'
 *   WHEN module = 'estate'
 *     AND step = 'POST_LEDGER'
 *     AND amount < 500000 TZS
 *     AND category = 'rent'
 *   THEN approve_by role_group = 'emu_officer' min = 1
 *   PRIORITY 200
 *
 * The PARSER converts that text into a `CompiledPredicate` JSON value.
 * The COMPILER persists it into `approval_matrix_dsl_compiled`.
 * The EVALUATOR runs predicates against an in-flight `ActionStep` and
 * returns the set of required role-groups.
 *
 * All step kinds in the `STEP_KINDS` array are recognised. Amount
 * comparisons normalise to micro-units of the named currency
 * (1 TZS = 1_000_000 micro-TZS) so the evaluator does integer math only.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Step kinds (must match action_steps.kind CHECK constraint)
// ─────────────────────────────────────────────────────────────────────

export const STEP_KINDS = [
  'DRAFT_LETTER',
  'ROUTE_APPROVAL',
  'POST_LEDGER',
  'FILE_GEPG',
  'SEND_WHATSAPP',
  'SEND_SMS',
  'SEND_EMAIL',
  'SCHEDULE_FIELD_VISIT',
  'MUTATE_ENTITY',
  'CALL_EXTERNAL_API',
  'EMIT_WEBHOOK',
  'NOTIFY',
  'VERIFY',
  'COMPENSATE',
] as const;

export const StepKindSchema = z.enum(STEP_KINDS);
export type StepKind = z.infer<typeof StepKindSchema>;

// ─────────────────────────────────────────────────────────────────────
// Power tier (matches persona-runtime hierarchy)
// ─────────────────────────────────────────────────────────────────────

export const POWER_TIERS = [1, 2, 3, 4, 5] as const;
export const PowerTierSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
export type PowerTier = z.infer<typeof PowerTierSchema>;

// ─────────────────────────────────────────────────────────────────────
// Amount comparison
// ─────────────────────────────────────────────────────────────────────

export const AMOUNT_OPS = ['<', '<=', '>', '>=', '==', '!='] as const;
export const AmountOpSchema = z.enum(AMOUNT_OPS);
export type AmountOp = z.infer<typeof AmountOpSchema>;

export const AmountCmpSchema = z.object({
  op: AmountOpSchema,
  /** Amount in micro-units of the named currency (or no currency). */
  valueMicros: z.number().int().nonnegative(),
});
export type AmountCmp = z.infer<typeof AmountCmpSchema>;

// ─────────────────────────────────────────────────────────────────────
// Compiled predicate
// ─────────────────────────────────────────────────────────────────────

export const CompiledPredicateSchema = z.object({
  /** Module slug (estate | finance | hr | compliance | …). */
  module: z.string().optional(),
  /** Step kind to match. */
  stepKind: StepKindSchema.optional(),
  /** Currency the amount comparison applies to (TZS|KES|NGN|USD|…). */
  currency: z.string().length(3).optional(),
  /** Amount comparison (against payload.amountMicros). */
  amountCmp: AmountCmpSchema.optional(),
  /**
   * Free-form attribute clauses. Each key must exist on the step's
   * payload `attributes` map. Special-case prefix matchers use the
   * `__prefix__` suffix on the key.
   */
  attributes: z.record(z.string(), z.unknown()).optional(),
  /** Actor's persona power tier. */
  actorPersonaTier: PowerTierSchema.optional(),
});

export type CompiledPredicate = z.infer<typeof CompiledPredicateSchema>;

// ─────────────────────────────────────────────────────────────────────
// Compiled rule row (mirror of `approval_matrix_dsl_compiled`)
// ─────────────────────────────────────────────────────────────────────

export const CompiledRuleSchema = z.object({
  id: z.string(),
  /** NULL = platform default. */
  tenantId: z.string().nullable(),
  ruleSlug: z.string(),
  predicate: CompiledPredicateSchema,
  requiredRoleGroup: z.string(),
  quorum: z.number().int().min(1).max(10),
  notifyRoleGroup: z.string().nullable(),
  priority: z.number().int(),
  active: z.boolean(),
});

export type CompiledRule = z.infer<typeof CompiledRuleSchema>;

// ─────────────────────────────────────────────────────────────────────
// Currency micro factor (1 unit = 1_000_000 micro-units)
// ─────────────────────────────────────────────────────────────────────

export const MICRO_FACTOR = 1_000_000;

export function toMicros(amount: number): number {
  return Math.round(amount * MICRO_FACTOR);
}

export function fromMicros(micros: number): number {
  return micros / MICRO_FACTOR;
}
