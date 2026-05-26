/**
 * Junior-chain routing port (Piece B — issue #39).
 *
 * Resolves "given the output of junior X, who should run next?" to a
 * list of `RoutingTarget`s (either another junior or a human role). The
 * matcher reads `routing_rules` rows for `(tenant_id, source_kind)` and
 * filters by the row's `condition_jsonb` predicate against the
 * payload.
 *
 * Predicate grammar (also documented in
 * `packages/database/src/schemas/routing-rules.schema.ts`):
 *
 *   Condition := { path: string; op: 'eq'|'neq'|'gte'|'lte'|'in'|'regex';
 *                  value: unknown }
 *   Predicate := {} | { all: Condition[] } | { any: Condition[] }
 *                 | { not: Predicate } | combinator hybrid
 *
 * `path` is a dotted lookup against the payload (e.g.
 * `output.severity`). Missing paths are treated as `undefined` for the
 * purpose of comparison.
 *
 * Distinct from `JuniorRoutingRulesLoader` in `./dispatcher.ts` — that loader
 * surfaces tenant-override RoutingMatrixRow records for the
 * entity/intent capture matrix. This port routes between juniors in
 * a finished chain.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Zod schemas
// ─────────────────────────────────────────────────────────────────────

export const RoutingConditionSchema = z.object({
  path: z.string().min(1),
  op: z.enum(['eq', 'neq', 'gte', 'lte', 'in', 'regex']),
  value: z.unknown(),
});

export type RoutingCondition = z.infer<typeof RoutingConditionSchema>;

export const RoutingPredicateSchema: z.ZodType<RoutingPredicate> = z.lazy(() =>
  z
    .object({
      all: z.array(RoutingConditionSchema).optional(),
      any: z.array(RoutingConditionSchema).optional(),
      not: RoutingPredicateSchema.optional(),
    })
    .strict(),
);

export interface RoutingPredicate {
  readonly all?: RoutingCondition[] | undefined;
  readonly any?: RoutingCondition[] | undefined;
  readonly not?: RoutingPredicate | undefined;
}

export const RoutingTargetSchema = z.object({
  ruleId: z.string().min(1),
  targetRole: z.enum(['junior', 'human']),
  targetKind: z.string().min(1),
  priority: z.number().int().min(0).max(1000),
});

export type RoutingTarget = z.infer<typeof RoutingTargetSchema>;

// ─────────────────────────────────────────────────────────────────────
// Port + loader
// ─────────────────────────────────────────────────────────────────────

export interface JuniorRoutingRulesPort {
  /**
   * Returns every matching `RoutingTarget` in priority-desc order.
   * Empty array when no rule matches.
   */
  lookup(
    sourceJunior: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<ReadonlyArray<RoutingTarget>>;
}

export interface RoutingRulesRow {
  readonly id: string;
  readonly tenantId: string;
  readonly sourceKind: string;
  readonly targetRole: 'junior' | 'human';
  readonly targetKind: string;
  readonly conditionJsonb: RoutingPredicate;
  readonly priority: number;
  readonly active: boolean;
}

export interface JuniorRoutingRulesLoader {
  /**
   * Returns every active rule for `(tenantId, sourceKind)` in
   * priority-desc, then created_at-asc order. Implementations: Drizzle
   * adapter (production), in-memory list (tests).
   */
  load(args: {
    readonly tenantId: string;
    readonly sourceKind: string;
  }): Promise<ReadonlyArray<RoutingRulesRow>>;
}

export interface CreateJuniorRoutingRulesPortArgs {
  readonly tenantId: string;
  readonly loader: JuniorRoutingRulesLoader;
}

export function createRoutingRulesPort(
  args: CreateJuniorRoutingRulesPortArgs,
): JuniorRoutingRulesPort {
  return {
    async lookup(sourceJunior, payload) {
      const rows = await args.loader.load({
        tenantId: args.tenantId,
        sourceKind: sourceJunior,
      });
      const matches: RoutingTarget[] = [];
      for (const row of rows) {
        if (!row.active) continue;
        if (!evaluatePredicate(row.conditionJsonb, payload)) continue;
        matches.push({
          ruleId: row.id,
          targetRole: row.targetRole,
          targetKind: row.targetKind,
          priority: row.priority,
        });
      }
      return matches.sort((a, b) => b.priority - a.priority);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Predicate evaluator (pure)
// ─────────────────────────────────────────────────────────────────────

export function evaluatePredicate(
  predicate: RoutingPredicate,
  payload: Readonly<Record<string, unknown>>,
): boolean {
  // Empty predicate {} = catch-all
  const hasAll = Array.isArray(predicate.all) && predicate.all.length > 0;
  const hasAny = Array.isArray(predicate.any) && predicate.any.length > 0;
  const hasNot = predicate.not !== undefined;

  if (!hasAll && !hasAny && !hasNot) return true;

  if (hasAll) {
    for (const cond of predicate.all ?? []) {
      if (!evaluateCondition(cond, payload)) return false;
    }
  }
  if (hasAny) {
    let ok = false;
    for (const cond of predicate.any ?? []) {
      if (evaluateCondition(cond, payload)) {
        ok = true;
        break;
      }
    }
    if (!ok) return false;
  }
  if (hasNot && predicate.not && evaluatePredicate(predicate.not, payload)) {
    return false;
  }
  return true;
}

function evaluateCondition(
  cond: RoutingCondition,
  payload: Readonly<Record<string, unknown>>,
): boolean {
  const actual = getByPath(payload, cond.path);
  switch (cond.op) {
    case 'eq':
      return actual === cond.value;
    case 'neq':
      return actual !== cond.value;
    case 'gte':
      return typeof actual === 'number' &&
        typeof cond.value === 'number' &&
        actual >= cond.value;
    case 'lte':
      return typeof actual === 'number' &&
        typeof cond.value === 'number' &&
        actual <= cond.value;
    case 'in':
      return Array.isArray(cond.value) && cond.value.includes(actual);
    case 'regex':
      if (typeof actual !== 'string' || typeof cond.value !== 'string') {
        return false;
      }
      try {
        return new RegExp(cond.value).test(actual);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function getByPath(
  obj: Readonly<Record<string, unknown>>,
  path: string,
): unknown {
  const parts = path.split('.');
  let cursor: unknown = obj;
  for (const part of parts) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}
