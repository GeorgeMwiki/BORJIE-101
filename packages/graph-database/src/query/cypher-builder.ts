/**
 * Fluent typed Cypher builder.
 *
 * Produces a `CypherQuery` value that the driver port accepts.
 * Builder enforces the tenant-isolation invariant: `.tenant(id)`
 * MUST be called before `.build()`, and the resulting Cypher
 * carries the tenant filter on every labelled pattern.
 *
 * Supports openCypher subset: MATCH, MERGE, CREATE, WHERE, RETURN,
 * SET, DELETE, ORDER BY, LIMIT. The dialect flag is openCypher
 * today; the GQL dialect can be added without breaking consumers.
 *
 * Design choice: builder is immutable — every chained call returns
 * a new builder instance. No mutation. Per coding-style.md.
 *
 * @module @borjie/graph-database/query/cypher-builder
 */

import {
  GraphDatabaseError,
  type CypherQuery,
  type GraphDriverId,
} from '../types.js';

// ---------------------------------------------------------------------------
// Pattern types
// ---------------------------------------------------------------------------

export type CypherClauseKind =
  | 'MATCH'
  | 'OPTIONAL_MATCH'
  | 'MERGE'
  | 'CREATE'
  | 'WHERE'
  | 'SET'
  | 'DELETE'
  | 'RETURN'
  | 'ORDER_BY'
  | 'LIMIT';

interface NodePattern {
  readonly variable: string;
  readonly labels: ReadonlyArray<string>;
  readonly properties: Readonly<Record<string, unknown>>;
}

interface RelPattern {
  readonly fromVariable: string;
  readonly toVariable: string;
  readonly type: string;
  readonly direction: 'out' | 'in' | 'both';
  readonly variable?: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

interface BuilderClause {
  readonly kind: CypherClauseKind;
  readonly text: string;
}

// ---------------------------------------------------------------------------
// CypherBuilder
// ---------------------------------------------------------------------------

export interface CypherBuilderState {
  readonly tenantId: string | null;
  readonly clauses: ReadonlyArray<BuilderClause>;
  readonly params: Readonly<Record<string, unknown>>;
  readonly readOnly: boolean;
  readonly preferredDriver?: GraphDriverId;
  readonly paramCounter: number;
}

const INITIAL_STATE: CypherBuilderState = {
  tenantId: null,
  clauses: [],
  params: {},
  readOnly: true,
  paramCounter: 0,
};

export class CypherBuilder {
  private readonly state: CypherBuilderState;

  constructor(state: CypherBuilderState = INITIAL_STATE) {
    this.state = state;
  }

  // -------------------------------------------------------------------------
  // Tenant binding — REQUIRED before build()
  // -------------------------------------------------------------------------

  public tenant(tenantId: string): CypherBuilder {
    if (!tenantId || tenantId.trim().length === 0) {
      throw new GraphDatabaseError(
        'tenant_scope_missing',
        'CypherBuilder.tenant() requires a non-empty tenantId',
      );
    }
    return new CypherBuilder({
      ...this.state,
      tenantId,
      params: { ...this.state.params, tenantId },
    });
  }

  // -------------------------------------------------------------------------
  // Driver hint (optional)
  // -------------------------------------------------------------------------

  public preferDriver(driver: GraphDriverId): CypherBuilder {
    return new CypherBuilder({ ...this.state, preferredDriver: driver });
  }

  // -------------------------------------------------------------------------
  // MATCH / OPTIONAL MATCH
  // -------------------------------------------------------------------------

  public match(pattern: NodePattern): CypherBuilder {
    const next = this.appendNodePattern('MATCH', pattern);
    return next;
  }

  public optionalMatch(pattern: NodePattern): CypherBuilder {
    const next = this.appendNodePattern('OPTIONAL_MATCH', pattern);
    return next;
  }

  // -------------------------------------------------------------------------
  // MERGE / CREATE — writes
  // -------------------------------------------------------------------------

  public merge(pattern: NodePattern): CypherBuilder {
    return this.appendNodePattern('MERGE', pattern).markWrite();
  }

  public create(pattern: NodePattern): CypherBuilder {
    return this.appendNodePattern('CREATE', pattern).markWrite();
  }

  // -------------------------------------------------------------------------
  // Relationships
  // -------------------------------------------------------------------------

  public matchRel(rel: RelPattern): CypherBuilder {
    const arrow = renderArrow(rel);
    const text = `MATCH (${rel.fromVariable})${arrow}(${rel.toVariable})`;
    return this.appendClause({ kind: 'MATCH', text });
  }

  public mergeRel(rel: RelPattern): CypherBuilder {
    const arrow = renderArrow(rel);
    const text = `MERGE (${rel.fromVariable})${arrow}(${rel.toVariable})`;
    return this.appendClause({ kind: 'MERGE', text }).markWrite();
  }

  // -------------------------------------------------------------------------
  // WHERE / SET / DELETE / RETURN / ORDER BY / LIMIT
  // -------------------------------------------------------------------------

  public where(predicate: string): CypherBuilder {
    return this.appendClause({ kind: 'WHERE', text: `WHERE ${predicate}` });
  }

  public set(assignment: string): CypherBuilder {
    return this.appendClause({
      kind: 'SET',
      text: `SET ${assignment}`,
    }).markWrite();
  }

  public delete(expression: string): CypherBuilder {
    return this.appendClause({
      kind: 'DELETE',
      text: `DELETE ${expression}`,
    }).markWrite();
  }

  public return(expression: string): CypherBuilder {
    return this.appendClause({
      kind: 'RETURN',
      text: `RETURN ${expression}`,
    });
  }

  public orderBy(expression: string): CypherBuilder {
    return this.appendClause({
      kind: 'ORDER_BY',
      text: `ORDER BY ${expression}`,
    });
  }

  public limit(n: number): CypherBuilder {
    if (!Number.isInteger(n) || n < 1) {
      throw new GraphDatabaseError(
        'invalid_cypher',
        `CypherBuilder.limit() requires positive integer, got ${String(n)}`,
      );
    }
    return this.appendClause({ kind: 'LIMIT', text: `LIMIT ${String(n)}` });
  }

  // -------------------------------------------------------------------------
  // Raw parameter injection (no string-interp; always parameterised)
  // -------------------------------------------------------------------------

  public param(name: string, value: unknown): CypherBuilder {
    if (!name || name.startsWith('$')) {
      throw new GraphDatabaseError(
        'parameter_validation_failed',
        `CypherBuilder.param() name must not be empty or start with '$' (got ${name})`,
      );
    }
    return new CypherBuilder({
      ...this.state,
      params: { ...this.state.params, [name]: value },
    });
  }

  // -------------------------------------------------------------------------
  // Build
  // -------------------------------------------------------------------------

  public build(): CypherQuery {
    if (this.state.tenantId === null) {
      throw new GraphDatabaseError(
        'tenant_scope_missing',
        'CypherBuilder.build() called without .tenant() — tenant isolation invariant violated',
      );
    }
    if (this.state.clauses.length === 0) {
      throw new GraphDatabaseError(
        'invalid_cypher',
        'CypherBuilder.build() called with no clauses',
      );
    }
    const cypher = this.state.clauses.map((c) => c.text).join('\n');
    const query: CypherQuery = {
      cypher,
      params: this.state.params,
      tenantId: this.state.tenantId,
      tenantScoped: true,
      readOnly: this.state.readOnly,
      ...(this.state.preferredDriver !== undefined
        ? { preferredDriver: this.state.preferredDriver }
        : {}),
    };
    return query;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private appendNodePattern(
    kind: CypherClauseKind,
    pattern: NodePattern,
  ): CypherBuilder {
    if (this.state.tenantId === null) {
      throw new GraphDatabaseError(
        'tenant_scope_missing',
        `Cannot ${kind} before .tenant() — tenant isolation invariant violated`,
      );
    }
    if (pattern.labels.length === 0) {
      throw new GraphDatabaseError(
        'invalid_cypher',
        `${kind} pattern requires ≥1 label (got 0 for variable ${pattern.variable})`,
      );
    }
    const labelPart = pattern.labels.map((l) => `:${l}`).join('');
    const propWithTenant = {
      ...pattern.properties,
      tenantId: '$tenantId',
    };
    const propPart = renderProperties(propWithTenant);
    const verb = kind === 'OPTIONAL_MATCH' ? 'OPTIONAL MATCH' : kind;
    const text = `${verb} (${pattern.variable}${labelPart} ${propPart})`;
    return this.appendClause({ kind, text });
  }

  private appendClause(clause: BuilderClause): CypherBuilder {
    return new CypherBuilder({
      ...this.state,
      clauses: [...this.state.clauses, clause],
    });
  }

  private markWrite(): CypherBuilder {
    return new CypherBuilder({ ...this.state, readOnly: false });
  }
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function renderArrow(rel: RelPattern): string {
  const variable = rel.variable ?? '';
  const propPart =
    Object.keys(rel.properties).length === 0
      ? ''
      : ` ${renderProperties(rel.properties)}`;
  const inner = `[${variable}:${rel.type}${propPart}]`;
  switch (rel.direction) {
    case 'out':
      return `-${inner}->`;
    case 'in':
      return `<-${inner}-`;
    case 'both':
      return `-${inner}-`;
  }
}

function renderProperties(properties: Readonly<Record<string, unknown>>): string {
  const keys = Object.keys(properties);
  if (keys.length === 0) return '';
  const inner = keys
    .map((k) => {
      const v = properties[k];
      if (typeof v === 'string' && v.startsWith('$')) {
        return `${k}: ${v}`;
      }
      return `${k}: ${JSON.stringify(v)}`;
    })
    .join(', ');
  return `{${inner}}`;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function cypher(): CypherBuilder {
  return new CypherBuilder();
}
