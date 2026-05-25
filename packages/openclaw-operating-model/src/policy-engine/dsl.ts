/**
 * Tiny policy DSL.
 *
 * Grammar (intentionally minimal, regulator-readable):
 *
 *   condition  := comparison ( ' and ' comparison )*
 *   comparison := IDENT op LITERAL
 *   op         := '==' | '!=' | '>' | '<' | '>=' | '<=' | 'in' | 'contains'
 *   LITERAL    := STRING | NUMBER | BOOLEAN | LIST
 *
 * Examples:
 *   "action.kind == \"billing\" and action.amount > 100000"
 *   "tenant.tier in [\"enterprise\",\"sovereign\"]"
 *   "action.tool contains \"destroy\""
 *
 * Evaluated against a flat key→value context. Unknown keys evaluate
 * comparisons to `false`. No string interpolation, no function calls
 * — deliberately constrained for auditability.
 */

export type DslValue = string | number | boolean | ReadonlyArray<string | number>;
export type DslContext = Readonly<Record<string, DslValue>>;

const OPS = ['==', '!=', '>=', '<=', '>', '<', ' in ', ' contains '] as const;

interface ParsedComparison {
  readonly key: string;
  readonly op: (typeof OPS)[number];
  readonly literal: DslValue;
}

interface ParsedCondition {
  readonly comparisons: ReadonlyArray<ParsedComparison>;
}

export function parseCondition(input: string): ParsedCondition {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error('parseCondition: empty condition');
  }
  // Split on ' and ' (case-insensitive)
  const parts = trimmed.split(/\s+and\s+/i);
  const comparisons = parts.map(parseComparison);
  return { comparisons };
}

function parseComparison(part: string): ParsedComparison {
  const s = part.trim();
  // Try ops longest-first so '>=' beats '>'
  const opsSorted = [...OPS].sort((a, b) => b.length - a.length);
  for (const op of opsSorted) {
    const trimmedOp = op.trim();
    // For ' in ' and ' contains ' rely on space-padded match
    const opPattern =
      op === ' in ' || op === ' contains '
        ? op
        : new RegExp(`\\s*${escapeRegex(trimmedOp)}\\s*`);
    let parts: string[];
    if (typeof opPattern === 'string') {
      const idx = s.indexOf(opPattern);
      if (idx === -1) continue;
      parts = [s.slice(0, idx), s.slice(idx + opPattern.length)];
    } else {
      const match = opPattern.exec(s);
      if (!match) continue;
      const idx = match.index;
      parts = [s.slice(0, idx), s.slice(idx + match[0].length)];
    }
    const key = parts[0]?.trim();
    const lit = parts[1]?.trim();
    if (!key || lit === undefined) continue;
    return { key, op, literal: parseLiteral(lit) };
  }
  throw new Error(`parseComparison: no recognised operator in "${part}"`);
}

function parseLiteral(raw: string): DslValue {
  const s = raw.trim();
  // Boolean
  if (s === 'true') return true;
  if (s === 'false') return false;
  // Number
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    return Number(s);
  }
  // List
  if (s.startsWith('[') && s.endsWith(']')) {
    const inside = s.slice(1, -1).trim();
    if (inside.length === 0) return [];
    const items = inside.split(',').map((item) => {
      const trimmed = item.trim();
      if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(1, -1);
      }
      if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
      return trimmed;
    });
    return items as ReadonlyArray<string | number>;
  }
  // String (quoted)
  if (s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1);
  }
  // Unquoted string fallback (bare identifier)
  return s;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function evaluateCondition(
  parsed: ParsedCondition,
  context: DslContext,
): boolean {
  return parsed.comparisons.every((c) => evaluateComparison(c, context));
}

function evaluateComparison(
  c: ParsedComparison,
  context: DslContext,
): boolean {
  const lhs = context[c.key];
  if (lhs === undefined) return false;
  switch (c.op) {
    case '==':
      return lhs === c.literal;
    case '!=':
      return lhs !== c.literal;
    case '>':
      return typeof lhs === 'number' && typeof c.literal === 'number' && lhs > c.literal;
    case '<':
      return typeof lhs === 'number' && typeof c.literal === 'number' && lhs < c.literal;
    case '>=':
      return typeof lhs === 'number' && typeof c.literal === 'number' && lhs >= c.literal;
    case '<=':
      return typeof lhs === 'number' && typeof c.literal === 'number' && lhs <= c.literal;
    case ' in ':
      if (Array.isArray(c.literal)) {
        return (c.literal as ReadonlyArray<string | number>).some(
          (item) => item === lhs,
        );
      }
      return false;
    case ' contains ':
      if (typeof lhs === 'string' && typeof c.literal === 'string') {
        return lhs.includes(c.literal);
      }
      if (Array.isArray(lhs) && (typeof c.literal === 'string' || typeof c.literal === 'number')) {
        return (lhs as ReadonlyArray<string | number>).some(
          (item) => item === c.literal,
        );
      }
      return false;
    default: {
      const _exhaustive: never = c.op;
      void _exhaustive;
      return false;
    }
  }
}
