/**
 * Unit tests for query-analyzer.ts — covers `formatSummary` and the
 * `explainQuery` helper end-to-end via a stubbed postgres-js client
 * with a `.begin()` transaction surface.
 */
import { describe, it, expect } from 'vitest';
import { explainQuery, formatSummary, type PlanSummary } from '../query-analyzer.js';
import type { DatabaseClient } from '../client.js';

interface MockPlanRoot {
  Plan: {
    'Node Type': string;
    'Total Cost'?: number;
    'Startup Cost'?: number;
    'Plan Rows'?: number;
    'Actual Rows'?: number;
    'Actual Total Time'?: number;
    'Shared Hit Blocks'?: number;
    'Shared Read Blocks'?: number;
    Plans?: ReadonlyArray<MockPlanRoot['Plan']>;
    Filter?: string;
    'Relation Name'?: string;
    'Index Name'?: string;
  };
  'Planning Time'?: number;
  'Execution Time'?: number;
}

function makeStubDb(plan: MockPlanRoot): DatabaseClient {
  const $client = {
    async begin(fn: (tx: (s: string, p?: unknown[]) => Promise<unknown>) => Promise<unknown>) {
      const tx = async (sql: string): Promise<unknown> => {
        if (sql.startsWith('EXPLAIN')) {
          return [{ 'QUERY PLAN': [plan] }];
        }
        if (sql === 'ROLLBACK') return undefined;
        return [];
      };
      return await fn(tx);
    },
  };
  return { $client } as unknown as DatabaseClient;
}

describe('explainQuery', () => {
  it('extracts cost and timing fields from the plan', async () => {
    const db = makeStubDb({
      Plan: {
        'Node Type': 'Seq Scan',
        'Total Cost': 100,
        'Startup Cost': 1.5,
        'Plan Rows': 50,
        'Actual Rows': 10,
        'Actual Total Time': 4.5,
        'Shared Hit Blocks': 8,
        'Shared Read Blocks': 2,
        'Relation Name': 'invoices',
        Filter: 'tenant_id = $1',
      },
      'Planning Time': 0.5,
      'Execution Time': 5,
    });
    const out = await explainQuery(db, 'SELECT * FROM invoices');
    expect(out.totalCostEstimate).toBe(100);
    expect(out.startupCostEstimate).toBe(1.5);
    expect(out.rowsEstimate).toBe(50);
    expect(out.actualRows).toBe(10);
    expect(out.planningMs).toBe(0.5);
    expect(out.executionMs).toBe(5);
    expect(out.sharedBlocksHit).toBe(8);
    expect(out.sharedBlocksRead).toBe(2);
  });

  it('records seq scans encountered in the plan', async () => {
    const db = makeStubDb({
      Plan: {
        'Node Type': 'Seq Scan',
        'Relation Name': 'invoices',
        'Actual Rows': 9000,
        'Actual Total Time': 12,
        Filter: 'status = $1',
      },
      'Execution Time': 12,
    });
    const out = await explainQuery(db, 'SELECT * FROM invoices');
    expect(out.seqScans).toHaveLength(1);
    expect(out.seqScans[0]?.relationName).toBe('invoices');
    expect(out.seqScans[0]?.actualRows).toBe(9000);
    expect(out.seqScans[0]?.filter).toBe('status = $1');
  });

  it('records indexes used in the plan', async () => {
    const db = makeStubDb({
      Plan: {
        'Node Type': 'Index Scan',
        'Index Name': 'invoices_tenant_idx',
      },
      'Execution Time': 1,
    });
    const out = await explainQuery(db, 'SELECT * FROM invoices');
    expect(out.indexesUsed).toContain('invoices_tenant_idx');
  });

  it('emits warning when seq scan exceeds threshold', async () => {
    const db = makeStubDb({
      Plan: {
        'Node Type': 'Seq Scan',
        'Relation Name': 'big_table',
        'Actual Rows': 5000,
      },
      'Execution Time': 1,
    });
    const out = await explainQuery(db, 'SELECT * FROM big_table', [], {
      seqScanWarnThreshold: 1000,
    });
    expect(out.warnings.length).toBeGreaterThanOrEqual(1);
    expect(out.warnings.some((w) => w.includes('big_table'))).toBe(true);
  });

  it('emits warning when execution exceeds slowQueryWarnMs', async () => {
    const db = makeStubDb({
      Plan: { 'Node Type': 'Index Scan' },
      'Execution Time': 1500,
    });
    const out = await explainQuery(db, 'SELECT 1', [], { slowQueryWarnMs: 500 });
    expect(out.warnings.some((w) => w.includes('Query execution took'))).toBe(true);
  });

  it('walks nested plans to collect node types', async () => {
    const db = makeStubDb({
      Plan: {
        'Node Type': 'Hash Join',
        Plans: [
          { 'Node Type': 'Seq Scan', 'Relation Name': 'a', 'Actual Rows': 5 },
          { 'Node Type': 'Index Scan', 'Index Name': 'b_idx' },
        ],
      },
      'Execution Time': 1,
    });
    const out = await explainQuery(db, 'SELECT * FROM a JOIN b ON a.id=b.id');
    expect(out.nodeTypes).toEqual(['Hash Join', 'Seq Scan', 'Index Scan']);
  });

  it('returns empty plan summary fields when client has no plan', async () => {
    const db = makeStubDb({
      Plan: { 'Node Type': 'Result' },
      'Execution Time': 0,
    });
    const out = await explainQuery(db, 'SELECT 1');
    expect(out.totalCostEstimate).toBe(0);
    expect(out.actualRows).toBe(0);
    expect(out.warnings).toEqual([]);
  });

  it('throws when DB client does not expose a postgres-js $client', async () => {
    const noClient = {} as DatabaseClient;
    await expect(explainQuery(noClient, 'SELECT 1')).rejects.toThrow(
      /could not locate underlying postgres client/,
    );
  });
});

describe('formatSummary', () => {
  function summary(overrides: Partial<PlanSummary> = {}): PlanSummary {
    return {
      query: 'SELECT 1',
      totalCostEstimate: 0,
      startupCostEstimate: 0,
      rowsEstimate: 0,
      actualRows: 0,
      actualTotalMs: 0,
      planningMs: 0,
      executionMs: 0,
      sharedBlocksHit: 0,
      sharedBlocksRead: 0,
      nodeTypes: ['Index Scan'],
      seqScans: [],
      indexesUsed: [],
      warnings: [],
      rawPlan: null,
      ...overrides,
    } as PlanSummary;
  }

  it('includes the query and plan node chain', () => {
    const out = formatSummary(summary({ nodeTypes: ['Hash Join', 'Seq Scan'] }));
    expect(out).toContain('SELECT 1');
    expect(out).toContain('Hash Join > Seq Scan');
  });

  it('truncates long queries with an ellipsis', () => {
    const long = 'SELECT '.padEnd(200, 'x');
    const out = formatSummary(summary({ query: long }));
    expect(out).toContain('…');
  });

  it('renders index lines when indexes were used', () => {
    const out = formatSummary(summary({ indexesUsed: ['a_idx', 'b_idx'] }));
    expect(out).toContain('idx:');
    expect(out).toContain('a_idx, b_idx');
  });

  it('renders WARN lines for each warning', () => {
    const out = formatSummary(
      summary({ warnings: ['too slow', 'too big'] }),
    );
    expect(out).toContain('WARN:  too slow');
    expect(out).toContain('WARN:  too big');
  });

  it('omits the seq line when there are no seq scans', () => {
    const out = formatSummary(summary());
    expect(out).not.toContain('seq:');
  });
});
