/**
 * Natural-language portfolio query.
 *
 * Owner asks: "Which properties returned less than 5% yield last quarter AND
 * have at least one arrears case open?" Parse via LLM → build a typed AST
 * → compile to Drizzle query against tenant-scoped data → stream result
 * rows + a natural-language summary.
 *
 * WHY AI-NATIVE: the owner doesn't have to learn SQL or our dashboards.
 * Any question; structured answer.
 */

import {
  type BudgetGuard,
  type ClassifyLLMPort,
  noopBudgetGuard,
  DEGRADED_MODEL_VERSION,
  promptHash,
  safeJsonParse,
  clamp01,
} from '../shared.js';

// ---------------------------------------------------------------------------
// Typed AST (the LLM is constrained to emit this shape)
// ---------------------------------------------------------------------------

export type QueryEntity =
  | 'properties'
  | 'units'
  | 'leases'
  | 'tenants'
  | 'invoices'
  | 'payments'
  | 'cases'
  | 'arrears';

export type Operator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'contains';

export interface Filter {
  readonly field: string; // pre-validated against an allowlist per entity
  readonly op: Operator;
  readonly value: string | number | boolean | readonly (string | number)[];
}

export interface QueryAST {
  readonly entity: QueryEntity;
  readonly filters: readonly Filter[];
  readonly groupBy?: string; // allowlisted column
  readonly orderBy?: { field: string; direction: 'asc' | 'desc' };
  readonly limit?: number; // default 50, max 500
}

// ---------------------------------------------------------------------------
// Field allowlist — anything the LLM proposes outside this is rejected.
// This is the anti-injection guardrail: we never pass the LLM's string
// straight to Drizzle; we only accept AST nodes matching this map.
// ---------------------------------------------------------------------------

export const QUERY_FIELD_ALLOWLIST: Readonly<
  Record<QueryEntity, readonly string[]>
> = {
  properties: ['id', 'name', 'country_code', 'created_at', 'yield_pct', 'grade'],
  units: ['id', 'property_id', 'status', 'bedrooms', 'rent_amount_minor'],
  leases: ['id', 'customer_id', 'status', 'start_date', 'end_date', 'rent_amount_minor'],
  tenants: ['id', 'created_at', 'country_code'],
  invoices: ['id', 'customer_id', 'status', 'due_date', 'amount_minor'],
  payments: ['id', 'customer_id', 'amount_minor', 'paid_at'],
  cases: ['id', 'customer_id', 'status', 'category', 'priority', 'created_at'],
  arrears: ['customer_id', 'days_overdue', 'balance_minor'],
} as const;

const VALID_OPERATORS: readonly Operator[] = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'contains',
];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export class InvalidQueryASTError extends Error {
  readonly code = 'INVALID_QUERY_AST' as const;
  constructor(message: string) {
    super(message);
    this.name = 'InvalidQueryASTError';
  }
}

export function validateAst(ast: unknown): QueryAST {
  if (!ast || typeof ast !== 'object') {
    throw new InvalidQueryASTError('ast must be an object');
  }
  const a = ast as Record<string, unknown>;
  const entity = a.entity as QueryEntity;
  if (!(entity in QUERY_FIELD_ALLOWLIST)) {
    throw new InvalidQueryASTError(`unknown entity: ${String(a.entity)}`);
  }
  const allowed = QUERY_FIELD_ALLOWLIST[entity];
  const filters = Array.isArray(a.filters) ? a.filters : [];
  const safeFilters: Filter[] = [];
  for (const f of filters) {
    if (!f || typeof f !== 'object') continue;
    const r = f as Record<string, unknown>;
    const field = typeof r.field === 'string' ? r.field : '';
    if (!allowed.includes(field)) {
      throw new InvalidQueryASTError(`field "${field}" not allowlisted for ${entity}`);
    }
    const op = r.op as Operator;
    if (!VALID_OPERATORS.includes(op)) {
      throw new InvalidQueryASTError(`operator "${String(r.op)}" not allowed`);
    }
    safeFilters.push({
      field,
      op,
      value: r.value as Filter['value'],
    });
  }
  const groupBy = typeof a.groupBy === 'string' ? a.groupBy : undefined;
  if (groupBy && !allowed.includes(groupBy)) {
    throw new InvalidQueryASTError(`groupBy "${groupBy}" not allowlisted`);
  }
  const orderByRaw = a.orderBy as Record<string, unknown> | undefined;
  const orderBy = orderByRaw
    ? {
        field:
          typeof orderByRaw.field === 'string' && allowed.includes(orderByRaw.field)
            ? orderByRaw.field
            : (() => {
                throw new InvalidQueryASTError('orderBy.field not allowlisted');
              })(),
        direction: (orderByRaw.direction === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc',
      }
    : undefined;
  const rawLimit = typeof a.limit === 'number' ? a.limit : 50;
  const limit = Math.max(1, Math.min(500, Math.floor(rawLimit)));

  return { entity, filters: safeFilters, groupBy, orderBy, limit };
}

// ---------------------------------------------------------------------------
// Compile AST → parameterized SQL (storage-agnostic; caller uses with its
// postgres-js / Drizzle client). Values are placeholder-style {$1,$2,...}
// so the caller binds them — NEVER interpolated.
// ---------------------------------------------------------------------------

export interface CompiledQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

const ENTITY_TABLE: Readonly<Record<QueryEntity, string>> = {
  properties: 'properties',
  units: 'units',
  leases: 'leases',
  tenants: 'tenants',
  invoices: 'invoices',
  payments: 'payments',
  cases: 'case_records',
  arrears: 'arrears_ledger',
};

function opToSql(op: Operator): string {
  switch (op) {
    case 'eq':
      return '=';
    case 'neq':
      return '<>';
    case 'gt':
      return '>';
    case 'gte':
      return '>=';
    case 'lt':
      return '<';
    case 'lte':
      return '<=';
    case 'contains':
      return 'ILIKE';
    case 'in':
      return 'IN';
  }
}

export function compileAst(ast: QueryAST, tenantId: string): CompiledQuery {
  const table = ENTITY_TABLE[ast.entity];
  const params: unknown[] = [tenantId];
  const where: string[] = ['tenant_id = $1'];

  for (const f of ast.filters) {
    if (f.op === 'in' && Array.isArray(f.value)) {
      const start = params.length + 1;
      const placeholders = f.value.map((v, i) => {
        params.push(v);
        return `$${start + i}`;
      });
      where.push(`${f.field} IN (${placeholders.join(',')})`);
    } else if (f.op === 'contains') {
      params.push(`%${String(f.value)}%`);
      where.push(`${f.field} ILIKE $${params.length}`);
    } else {
      params.push(f.value);
      where.push(`${f.field} ${opToSql(f.op)} $${params.length}`);
    }
  }

  let sql = `SELECT * FROM ${table} WHERE ${where.join(' AND ')}`;
  if (ast.orderBy) {
    sql += ` ORDER BY ${ast.orderBy.field} ${ast.orderBy.direction.toUpperCase()}`;
  }
  sql += ` LIMIT ${ast.limit ?? 50}`;
  return { sql, params };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface NlQueryRunner {
  runSql(
    tenantId: string,
    sql: string,
    params: readonly unknown[],
  ): Promise<readonly Record<string, unknown>[]>;
}

export interface NaturalLanguageQueryDeps {
  readonly runner: NlQueryRunner;
  readonly llm?: ClassifyLLMPort;
  readonly budgetGuard?: BudgetGuard;
  readonly summarize?: boolean;
}

export interface NLQueryResult {
  readonly ast: QueryAST;
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly rows: readonly Record<string, unknown>[];
  readonly summary: string | null;
  readonly modelVersion: string;
  readonly promptHash: string;
  readonly confidence: number | null;
}

const PARSE_SYSTEM_PROMPT = `You compile an operator question into a STRICT JSON AST for a property-management
database. Allowed entities: properties, units, leases, tenants, invoices, payments, cases, arrears.
Return ONLY JSON:
{
  "entity": string,
  "filters": [ { "field": string, "op": "eq"|"neq"|"gt"|"gte"|"lt"|"lte"|"in"|"contains", "value": any } ],
  "groupBy": string | null,
  "orderBy": { "field": string, "direction": "asc" | "desc" } | null,
  "limit": number,
  "confidence": number (0..1),
  "summary": string
}
Fields MUST be snake_case column names; invent nothing.`;

export interface NaturalLanguageQuery {
  ask(params: {
    tenantId: string;
    question: string;
  }): Promise<NLQueryResult>;
}

export function createNaturalLanguageQuery(
  deps: NaturalLanguageQueryDeps,
): NaturalLanguageQuery {
  const guard = deps.budgetGuard ?? noopBudgetGuard;

  return {
    async ask({ tenantId, question }) {
      if (!tenantId || !question) {
        throw new Error('natural-language-query.ask: missing required fields');
      }
      const system = PARSE_SYSTEM_PROMPT;
      const user = `Question: """${question}"""`;
      const hash = promptHash(system + '\n---\n' + user);

      if (!deps.llm) {
        throw new Error(
          'natural-language-query: LLM port unavailable — configure OPENAI_API_KEY or ANTHROPIC_API_KEY',
        );
      }
      await guard(tenantId, 'natural-language-query:parse');

      const res = await deps.llm.classify({ systemPrompt: system, userPrompt: user });
      const parsed = safeJsonParse<Record<string, unknown>>(res.raw);
      if (!parsed) {
        throw new InvalidQueryASTError('LLM returned unparseable response');
      }
      const ast = validateAst(parsed);
      const { sql, params } = compileAst(ast, tenantId);
      const rows = await deps.runner.runSql(tenantId, sql, params);
      const summary =
        typeof parsed.summary === 'string'
          ? parsed.summary
          : `Returned ${rows.length} rows from ${ast.entity}.`;
      return {
        ast,
        sql,
        params,
        rows,
        summary,
        modelVersion: res.modelVersion || DEGRADED_MODEL_VERSION,
        promptHash: hash,
        confidence:
          typeof parsed.confidence === 'number' ? clamp01(parsed.confidence) : null,
      };
    },
  };
}
