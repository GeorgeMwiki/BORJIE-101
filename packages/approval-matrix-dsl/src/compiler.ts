/**
 * Approval matrix DSL compiler — turns a `ParsedRule` into the
 * persistence-ready row shape for `approval_matrix_dsl_compiled`.
 *
 * The compiler also runs invariants:
 *   * predicate has at least one clause
 *   * required_role_group is non-empty
 *   * quorum 1..10
 *   * priority is an int
 *
 * It does NOT persist; the caller (an admin script or migration) inserts
 * the row through the persistence port.
 */

import {
  CompiledPredicateSchema,
  CompiledRuleSchema,
  type CompiledPredicate,
  type CompiledRule,
} from './grammar.js';
import {
  ApprovalMatrixDslParseError,
  parseRule,
  type ParsedRule,
} from './parser.js';

export interface CompileOptions {
  /** id to use for the row; defaults to `amdc_${tenantPrefix}${ruleSlug}`. */
  readonly id?: string;
  /** NULL = platform default. */
  readonly tenantId: string | null;
  /** Mark active/inactive; defaults to true. */
  readonly active?: boolean;
}

export class ApprovalMatrixDslCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalMatrixDslCompileError';
  }
}

function predicateHasAnyClause(predicate: CompiledPredicate): boolean {
  return (
    predicate.module !== undefined ||
    predicate.stepKind !== undefined ||
    predicate.currency !== undefined ||
    predicate.amountCmp !== undefined ||
    predicate.actorPersonaTier !== undefined ||
    (predicate.attributes !== undefined &&
      Object.keys(predicate.attributes).length > 0)
  );
}

export function compileParsedRule(
  rule: ParsedRule,
  options: CompileOptions,
): CompiledRule {
  if (!predicateHasAnyClause(rule.predicate)) {
    throw new ApprovalMatrixDslCompileError(
      `rule '${rule.ruleSlug}' has no clauses — the predicate would match every step`,
    );
  }

  const predicate = CompiledPredicateSchema.parse(rule.predicate);
  const id =
    options.id ??
    `amdc_${options.tenantId ? `${options.tenantId}_` : ''}${rule.ruleSlug}`;

  const compiled: CompiledRule = {
    id,
    tenantId: options.tenantId,
    ruleSlug: rule.ruleSlug,
    predicate,
    requiredRoleGroup: rule.requiredRoleGroup,
    quorum: rule.quorum,
    notifyRoleGroup: rule.notifyRoleGroup ?? null,
    priority: rule.priority,
    active: options.active ?? true,
  };
  return CompiledRuleSchema.parse(compiled);
}

export function compileDsl(
  source: string,
  options: CompileOptions,
): CompiledRule {
  let parsed: ParsedRule;
  try {
    parsed = parseRule(source);
  } catch (err) {
    if (err instanceof ApprovalMatrixDslParseError) {
      throw new ApprovalMatrixDslCompileError(
        `parse error: ${err.message}${err.lineNumber ? ` (line ${err.lineNumber})` : ''}`,
      );
    }
    throw err;
  }
  return compileParsedRule(parsed, options);
}

// ─────────────────────────────────────────────────────────────────────
// Inverse — render a compiled rule back to DSL (used by the admin UI
// to display canonical source).
// ─────────────────────────────────────────────────────────────────────

export function renderCompiledRule(rule: CompiledRule): string {
  const lines: string[] = [`RULE '${rule.ruleSlug}'`];

  const clauses: string[] = [];
  if (rule.predicate.module) clauses.push(`module = '${rule.predicate.module}'`);
  if (rule.predicate.stepKind) clauses.push(`step = '${rule.predicate.stepKind}'`);
  if (rule.predicate.amountCmp && rule.predicate.currency) {
    const value = rule.predicate.amountCmp.valueMicros / 1_000_000;
    clauses.push(
      `amount ${rule.predicate.amountCmp.op} ${value} ${rule.predicate.currency}`,
    );
  }
  if (rule.predicate.actorPersonaTier !== undefined) {
    clauses.push(`actor_tier == ${rule.predicate.actorPersonaTier}`);
  }
  if (rule.predicate.attributes) {
    for (const [key, value] of Object.entries(rule.predicate.attributes)) {
      if (
        value !== null &&
        typeof value === 'object' &&
        '__prefix__' in (value as Record<string, unknown>)
      ) {
        const prefix = (value as { readonly __prefix__: string }).__prefix__;
        clauses.push(`${key} startswith '${prefix}'`);
      } else if (typeof value === 'string') {
        clauses.push(`${key} = '${value}'`);
      } else {
        clauses.push(`${key} = '${JSON.stringify(value)}'`);
      }
    }
  }

  if (clauses.length > 0) {
    lines.push(`WHEN ${clauses.join(' AND ')}`);
  }

  lines.push(
    `THEN approve_by role_group = '${rule.requiredRoleGroup}' min = ${rule.quorum}`,
  );
  if (rule.notifyRoleGroup) {
    lines.push(`NOTIFY role_group = '${rule.notifyRoleGroup}'`);
  }
  lines.push(`PRIORITY ${rule.priority}`);

  return lines.join('\n');
}
