import { describe, it, expect } from 'vitest';
import {
  validateAst,
  compileAst,
  createNaturalLanguageQuery,
  InvalidQueryASTError,
} from '../natural-language-query/index.js';
import type { ClassifyLLMPort } from '../shared.js';

describe('natural-language-query', () => {
  it('validateAst rejects unknown entity', () => {
    expect(() => validateAst({ entity: 'universe', filters: [] })).toThrow(
      InvalidQueryASTError,
    );
  });

  it('validateAst rejects non-allowlisted field', () => {
    expect(() =>
      validateAst({
        entity: 'properties',
        filters: [{ field: 'secret_column', op: 'eq', value: 1 }],
      }),
    ).toThrow(InvalidQueryASTError);
  });

  it('compileAst produces parameterized SQL with tenant scoping', () => {
    const ast = validateAst({
      entity: 'properties',
      filters: [
        { field: 'country_code', op: 'eq', value: 'KE' },
        { field: 'yield_pct', op: 'gte', value: 5 },
      ],
      orderBy: { field: 'created_at', direction: 'desc' },
      limit: 20,
    });
    const compiled = compileAst(ast, 't1');
    expect(compiled.sql).toMatch(/^SELECT \* FROM properties WHERE tenant_id = \$1/);
    expect(compiled.sql).toContain('country_code = $2');
    expect(compiled.sql).toContain('yield_pct >= $3');
    expect(compiled.sql).toContain('ORDER BY created_at DESC');
    expect(compiled.sql).toContain('LIMIT 20');
    expect(compiled.params).toEqual(['t1', 'KE', 5]);
  });

  it('ask() runs the full LLM → AST → SQL pipeline', async () => {
    const llm: ClassifyLLMPort = {
      async classify() {
        return {
          raw: JSON.stringify({
            entity: 'properties',
            filters: [{ field: 'country_code', op: 'eq', value: 'KE' }],
            limit: 10,
            confidence: 0.9,
            summary: '1 match',
          }),
          modelVersion: 'claude',
          inputTokens: 1,
          outputTokens: 1,
        };
      },
    };
    const svc = createNaturalLanguageQuery({
      runner: {
        async runSql(tenantId, sql, params) {
          expect(tenantId).toBe('t1');
          expect(params[0]).toBe('t1');
          expect(sql).toContain('properties');
          return [{ id: 'p1', name: 'Test' }];
        },
      },
      llm,
    });
    const res = await svc.ask({ tenantId: 't1', question: 'Kenya properties?' });
    expect(res.rows).toHaveLength(1);
    expect(res.summary).toBe('1 match');
    expect(res.modelVersion).toBe('claude');
    expect(res.confidence).toBeCloseTo(0.9);
  });

  it('ask() throws when LLM port is missing', async () => {
    const svc = createNaturalLanguageQuery({
      runner: { async runSql() { return []; } },
    });
    await expect(svc.ask({ tenantId: 't1', question: 'anything' })).rejects.toThrow(
      /LLM port unavailable/i,
    );
  });
});
