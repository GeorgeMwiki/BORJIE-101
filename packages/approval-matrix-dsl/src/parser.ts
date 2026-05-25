/**
 * Approval matrix DSL parser.
 *
 * Accepts a human-authored rule and returns a `ParsedRule` (which the
 * compiler then persists). The grammar is a simple line-oriented form:
 *
 *   RULE 'rule_slug'
 *   WHEN <clause> AND <clause> AND …
 *   THEN approve_by role_group = '<role_group>' min = <quorum>
 *   [NOTIFY role_group = '<role_group>']
 *   PRIORITY <int>
 *
 * Clauses:
 *   module = '<slug>'
 *   step = '<STEP_KIND>'
 *   amount <op> <number> <CCY>          op ∈ < <= > >= == !=
 *   actor_tier <op> <int>               op ∈ < <= > >= == !=  (1..5)
 *   <key> = '<value>'                   any free-form attribute
 *   <key> startswith '<prefix>'         prefix match → attributes[key] = { __prefix__: 'x' }
 *
 * The grammar is deliberately small — non-trivial logic (OR, NOT, nested
 * predicates) belongs in code, not a config file. The DSL is for the 80%
 * of rules an approval administrator reasons about.
 */

import {
  AMOUNT_OPS,
  STEP_KINDS,
  type AmountCmp,
  type AmountOp,
  type CompiledPredicate,
} from './grammar.js';
import { MICRO_FACTOR } from './grammar.js';

export interface ParsedRule {
  readonly ruleSlug: string;
  readonly predicate: CompiledPredicate;
  /** The currency the amount comparison was authored in. */
  readonly currency?: string;
  readonly requiredRoleGroup: string;
  readonly quorum: number;
  readonly notifyRoleGroup?: string;
  readonly priority: number;
}

export class ApprovalMatrixDslParseError extends Error {
  constructor(
    message: string,
    public readonly lineNumber?: number,
  ) {
    super(message);
    this.name = 'ApprovalMatrixDslParseError';
  }
}

// ─────────────────────────────────────────────────────────────────────
// Line normaliser
// ─────────────────────────────────────────────────────────────────────

function preprocess(input: string): ReadonlyArray<{ line: string; lineNumber: number }> {
  const raw = input
    .split('\n')
    .map((line, idx) => ({ line: line.trim(), lineNumber: idx + 1 }))
    .filter(({ line }) => line.length > 0 && !line.startsWith('--'));

  // Split single-line rules at top-level keywords (RULE / WHEN / THEN /
  // NOTIFY / PRIORITY). This lets authors put the whole rule on one
  // physical line if they prefer; the parser still sees four logical
  // statements.
  const splits: { line: string; lineNumber: number }[] = [];
  const KEYWORD_SPLIT = /(?=\b(?:RULE|WHEN|THEN|NOTIFY|PRIORITY)\b)/i;
  for (const entry of raw) {
    const parts = entry.line
      .split(KEYWORD_SPLIT)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    for (const part of parts) {
      splits.push({ line: part, lineNumber: entry.lineNumber });
    }
  }

  // Fold continuation lines: lines starting with AND / OR / NOT belong to
  // the previous statement (typically the WHEN body). This lets authors
  // pretty-print multi-clause WHENs across several lines.
  const folded: { line: string; lineNumber: number }[] = [];
  for (const entry of splits) {
    if (/^(AND|OR|NOT)\b/i.test(entry.line) && folded.length > 0) {
      const prev = folded[folded.length - 1];
      if (prev) {
        folded[folded.length - 1] = {
          line: `${prev.line} ${entry.line}`,
          lineNumber: prev.lineNumber,
        };
        continue;
      }
    }
    folded.push(entry);
  }
  return folded;
}

// ─────────────────────────────────────────────────────────────────────
// Quoted-string helper
// ─────────────────────────────────────────────────────────────────────

function extractQuoted(input: string, key: string): string {
  const re = new RegExp(`${key}\\s*=\\s*'([^']+)'`, 'i');
  const match = re.exec(input);
  if (!match || !match[1]) {
    throw new ApprovalMatrixDslParseError(
      `expected ${key} = '...' in: ${input}`,
    );
  }
  return match[1];
}

function extractInt(input: string, key: string): number {
  const re = new RegExp(`${key}\\s*=\\s*(-?\\d+)`, 'i');
  const match = re.exec(input);
  if (!match || !match[1]) {
    throw new ApprovalMatrixDslParseError(`expected ${key} = <int> in: ${input}`);
  }
  return parseInt(match[1], 10);
}

// ─────────────────────────────────────────────────────────────────────
// Clause parser
// ─────────────────────────────────────────────────────────────────────

interface ParsedClauseAcc {
  predicate: CompiledPredicate;
  currency?: string;
}

function isAmountOp(s: string): s is AmountOp {
  return (AMOUNT_OPS as ReadonlyArray<string>).includes(s);
}

function parseClause(
  clause: string,
  acc: ParsedClauseAcc,
  lineNumber: number,
): ParsedClauseAcc {
  const trimmed = clause.trim();

  // module = '...'
  const moduleMatch = /^module\s*=\s*'([^']+)'$/i.exec(trimmed);
  if (moduleMatch && moduleMatch[1]) {
    return {
      ...acc,
      predicate: { ...acc.predicate, module: moduleMatch[1] },
    };
  }

  // step = '...'
  const stepMatch = /^step\s*=\s*'([^']+)'$/i.exec(trimmed);
  if (stepMatch && stepMatch[1]) {
    const stepKind = stepMatch[1];
    if (!(STEP_KINDS as ReadonlyArray<string>).includes(stepKind)) {
      throw new ApprovalMatrixDslParseError(
        `unknown step kind '${stepKind}'`,
        lineNumber,
      );
    }
    return {
      ...acc,
      predicate: {
        ...acc.predicate,
        stepKind: stepKind as CompiledPredicate['stepKind'],
      },
    };
  }

  // amount <op> <num> <CCY>
  const amountMatch =
    /^amount\s*(<=|>=|==|!=|<|>)\s*([\d.]+)\s*([A-Z]{3})$/i.exec(trimmed);
  if (amountMatch && amountMatch[1] && amountMatch[2] && amountMatch[3]) {
    const op = amountMatch[1] as string;
    if (!isAmountOp(op)) {
      throw new ApprovalMatrixDslParseError(
        `unsupported amount op '${op}'`,
        lineNumber,
      );
    }
    // P84 audit BUG-HI-7: `parseFloat('1e308')` returns Infinity, and
    // `Math.round(Infinity * MICRO_FACTOR)` returns Infinity. Without
    // this guard the predicate `amountCmp <= Infinity` silently
    // approves any amount. Reject Infinity / NaN / negative loudly.
    const value = parseFloat(amountMatch[2]);
    if (!Number.isFinite(value) || value < 0) {
      throw new ApprovalMatrixDslParseError(
        `amount must be a finite non-negative number, got '${amountMatch[2]}'`,
        lineNumber,
      );
    }
    const micros = Math.round(value * MICRO_FACTOR);
    if (!Number.isSafeInteger(micros)) {
      throw new ApprovalMatrixDslParseError(
        `amount overflows the safe-integer micro range, got '${amountMatch[2]}'`,
        lineNumber,
      );
    }
    const currency = amountMatch[3].toUpperCase();
    const cmp: AmountCmp = {
      op,
      valueMicros: micros,
    };
    return {
      predicate: {
        ...acc.predicate,
        amountCmp: cmp,
        currency,
      },
      currency,
    };
  }

  // actor_tier <op> <int>
  const tierMatch =
    /^actor_tier\s*(<=|>=|==|!=|<|>)\s*(\d+)$/i.exec(trimmed);
  if (tierMatch && tierMatch[1] && tierMatch[2]) {
    const op = tierMatch[1];
    const tier = parseInt(tierMatch[2], 10);
    if (tier < 1 || tier > 5) {
      throw new ApprovalMatrixDslParseError(
        `actor_tier must be in 1..5, got ${tier}`,
        lineNumber,
      );
    }
    // Only `==` is materialised in the compiled predicate today;
    // <,<=,>,>= require an attribute predicate dispatch that we
    // expose later. Accept the op but rewrite to attribute clause.
    if (op === '==') {
      return {
        ...acc,
        predicate: {
          ...acc.predicate,
          actorPersonaTier: tier as 1 | 2 | 3 | 4 | 5,
        },
      };
    }
    return {
      ...acc,
      predicate: {
        ...acc.predicate,
        attributes: {
          ...(acc.predicate.attributes ?? {}),
          actorTierCmp: { op, tier },
        },
      },
    };
  }

  // <key> startswith '<prefix>'
  const prefixMatch = /^(\w+)\s+startswith\s+'([^']+)'$/i.exec(trimmed);
  if (prefixMatch && prefixMatch[1] && prefixMatch[2]) {
    const key = prefixMatch[1];
    const prefix = prefixMatch[2];
    return {
      ...acc,
      predicate: {
        ...acc.predicate,
        attributes: {
          ...(acc.predicate.attributes ?? {}),
          [key]: { __prefix__: prefix },
        },
      },
    };
  }

  // <key> = '<value>'  (catch-all attribute)
  const attrMatch = /^(\w+)\s*=\s*'([^']+)'$/i.exec(trimmed);
  if (attrMatch && attrMatch[1] && attrMatch[2]) {
    const key = attrMatch[1];
    const value = attrMatch[2];
    return {
      ...acc,
      predicate: {
        ...acc.predicate,
        attributes: {
          ...(acc.predicate.attributes ?? {}),
          [key]: value,
        },
      },
    };
  }

  throw new ApprovalMatrixDslParseError(
    `unrecognised clause: ${trimmed}`,
    lineNumber,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Rule parser
// ─────────────────────────────────────────────────────────────────────

export function parseRule(input: string): ParsedRule {
  const lines = preprocess(input);
  if (lines.length === 0) {
    throw new ApprovalMatrixDslParseError('empty rule');
  }

  let ruleSlug: string | undefined;
  let predicate: CompiledPredicate = {};
  let currency: string | undefined;
  let requiredRoleGroup: string | undefined;
  let quorum = 1;
  let notifyRoleGroup: string | undefined;
  let priority = 100;

  let i = 0;
  while (i < lines.length) {
    const entry = lines[i];
    if (!entry) {
      i += 1;
      continue;
    }
    const line = entry.line;

    // RULE 'slug'
    if (/^RULE\s+'[^']+'$/i.test(line)) {
      ruleSlug = extractRuleSlug(line);
      i += 1;
      continue;
    }

    // WHEN ... [AND ...]
    if (/^WHEN\b/i.test(line)) {
      const body = line.replace(/^WHEN\s+/i, '');
      const clauses = body.split(/\s+AND\s+/i);
      let acc: ParsedClauseAcc = { predicate, ...(currency ? { currency } : {}) };
      for (const c of clauses) {
        acc = parseClause(c, acc, entry.lineNumber);
      }
      predicate = acc.predicate;
      if (acc.currency) {
        currency = acc.currency;
      }
      i += 1;
      continue;
    }

    // THEN approve_by role_group = '...' min = N
    if (/^THEN\s+approve_by\b/i.test(line)) {
      requiredRoleGroup = extractQuoted(line, 'role_group');
      quorum = extractInt(line, 'min');
      i += 1;
      continue;
    }

    // NOTIFY role_group = '...'
    if (/^NOTIFY\b/i.test(line)) {
      notifyRoleGroup = extractQuoted(line, 'role_group');
      i += 1;
      continue;
    }

    // PRIORITY <int>
    if (/^PRIORITY\b/i.test(line)) {
      const m = /^PRIORITY\s+(-?\d+)$/i.exec(line);
      if (m && m[1]) {
        priority = parseInt(m[1], 10);
      }
      i += 1;
      continue;
    }

    throw new ApprovalMatrixDslParseError(
      `unrecognised statement: ${line}`,
      entry.lineNumber,
    );
  }

  if (!ruleSlug) {
    throw new ApprovalMatrixDslParseError(
      'rule missing RULE \'<slug>\' header',
    );
  }
  if (!requiredRoleGroup) {
    throw new ApprovalMatrixDslParseError(
      `rule '${ruleSlug}' missing THEN approve_by clause`,
    );
  }
  if (quorum < 1 || quorum > 10) {
    throw new ApprovalMatrixDslParseError(
      `rule '${ruleSlug}' quorum out of range (1..10), got ${quorum}`,
    );
  }

  const parsed: ParsedRule = {
    ruleSlug,
    predicate,
    ...(currency ? { currency } : {}),
    requiredRoleGroup,
    quorum,
    ...(notifyRoleGroup ? { notifyRoleGroup } : {}),
    priority,
  };
  return parsed;
}

function extractRuleSlug(line: string): string {
  const m = /^RULE\s+'([^']+)'$/i.exec(line);
  if (!m || !m[1]) {
    throw new ApprovalMatrixDslParseError(`expected RULE '<slug>' got: ${line}`);
  }
  return m[1];
}
