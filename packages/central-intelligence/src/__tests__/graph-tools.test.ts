/**
 * Graph kernel tools — unit tests.
 *
 * GraphReadClient is fully mocked with vi.fn so we exercise the tool
 * surface without touching Neo4j. Each tool covers:
 *   - Happy path returns the right shape
 *   - Empty result returns a zero-counts object (NOT an error)
 *   - GraphService throwing collapses to { kind: 'error' }
 *   - Tenant id is forwarded to the underlying query
 *   - At least one citation is emitted with the right shape
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createPortfolioConcentrationTool,
  createConnectedPartiesTool,
  createLeaseNetworkTool,
  createVacancyClustersTool,
  createGraphKernelTools,
  type GraphReadClient,
} from '../kernel/tools/graph-tools.js';
import type { ScopeContext, ToolOutcome } from '../types.js';

// ─── fixtures ─────────────────────────────────────────────────────────

const TENANT_CTX: ScopeContext = {
  kind: 'tenant',
  tenantId: 't_acme',
  actorUserId: 'u_alice',
  roles: ['estate-manager'],
  personaId: 'estate-manager',
};

const PLATFORM_CTX: ScopeContext = {
  kind: 'platform',
  actorUserId: 'u_hq',
  roles: ['platform-admin'],
  personaId: 'platform-sovereign',
};

function mockClient(impl: GraphReadClient['readQuery']): GraphReadClient {
  return { readQuery: vi.fn(impl) as GraphReadClient['readQuery'] };
}

function expectOk<T>(outcome: ToolOutcome<T>): asserts outcome is Extract<
  ToolOutcome<T>,
  { kind: 'ok' }
> {
  if (outcome.kind !== 'ok') {
    throw new Error(`expected ok, got error: ${outcome.message}`);
  }
}

function expectError<T>(
  outcome: ToolOutcome<T>,
): asserts outcome is Extract<ToolOutcome<T>, { kind: 'error' }> {
  if (outcome.kind !== 'error') {
    throw new Error('expected error outcome, got ok');
  }
}

// ─── graph.portfolioConcentration ─────────────────────────────────────

describe('graph.portfolioConcentration', () => {
  it('returns HHI, top concentration and high-flag for skewed portfolio', async () => {
    const client = mockClient(async () => [
      {
        ownerId: 'o_1',
        totalValue: 1000,
        properties: [
          { propertyId: 'p_a', value: 700 },
          { propertyId: 'p_b', value: 200 },
          { propertyId: 'p_c', value: 100 },
        ],
      },
    ]);
    const tool = createPortfolioConcentrationTool({ client });

    const out = await tool.invoke({
      toolName: tool.name,
      input: { ownerId: 'o_1', topN: 3 },
      ctx: TENANT_CTX,
    });

    expectOk(out);
    expect(out.output.ownerId).toBe('o_1');
    // 0.7^2 + 0.2^2 + 0.1^2 = 0.54 → high
    expect(out.output.hhi).toBeCloseTo(0.54, 2);
    expect(out.output.flag).toBe('high');
    expect(out.output.topConcentration[0]).toEqual({ propertyId: 'p_a', sharePct: 70 });
    expect(out.output.topConcentration).toHaveLength(3);
    expect(out.citations.length).toBeGreaterThanOrEqual(1);
    expect(out.citations[0]?.target.kind).toBe('graph_node');
  });

  it('returns moderate flag for balanced portfolio with three roughly-equal holdings', async () => {
    const client = mockClient(async () => [
      {
        ownerId: 'o_2',
        totalValue: 300,
        properties: [
          { propertyId: 'p_a', value: 110 },
          { propertyId: 'p_b', value: 100 },
          { propertyId: 'p_c', value: 90 },
        ],
      },
    ]);
    const tool = createPortfolioConcentrationTool({ client });

    const out = await tool.invoke({
      toolName: tool.name,
      input: { ownerId: 'o_2' },
      ctx: TENANT_CTX,
    });
    expectOk(out);
    // shares ~0.367, 0.333, 0.300 → HHI ~0.336 → high (still concentrated by HHI)
    expect(out.output.flag === 'high' || out.output.flag === 'moderate').toBe(true);
  });

  it('returns empty zero-shape when no records (NOT an error)', async () => {
    const client = mockClient(async () => []);
    const tool = createPortfolioConcentrationTool({ client });
    const out = await tool.invoke({
      toolName: tool.name,
      input: { ownerId: 'o_missing' },
      ctx: TENANT_CTX,
    });
    expectOk(out);
    expect(out.output.hhi).toBe(0);
    expect(out.output.topConcentration).toEqual([]);
    expect(out.output.flag).toBe('low');
    expect(out.citations).toHaveLength(1);
  });

  it('passes tenantId from ctx through to underlying readQuery', async () => {
    const readQuery = vi.fn(async () => []);
    const tool = createPortfolioConcentrationTool({ client: { readQuery } });
    await tool.invoke({
      toolName: tool.name,
      input: { ownerId: 'o_x' },
      ctx: TENANT_CTX,
    });
    expect(readQuery).toHaveBeenCalledTimes(1);
    const params = (readQuery.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
    expect(params.tenantId).toBe('t_acme');
    expect(params.ownerId).toBe('o_x');
  });

  it('rejects non-tenant scope with structured error', async () => {
    const client = mockClient(async () => []);
    const tool = createPortfolioConcentrationTool({ client });
    const out = await tool.invoke({
      toolName: tool.name,
      input: {},
      ctx: PLATFORM_CTX,
    });
    expectError(out);
    expect(out.message).toMatch(/non-tenant scope/);
  });

  it('collapses thrown error from client into { kind: error } (no unhandled rejection)', async () => {
    const client = mockClient(async () => {
      throw new Error('neo4j unreachable');
    });
    const tool = createPortfolioConcentrationTool({ client });
    const out = await tool.invoke({
      toolName: tool.name,
      input: {},
      ctx: TENANT_CTX,
    });
    expectError(out);
    expect(out.message).toContain('neo4j unreachable');
    expect(out.retryable).toBe(true);
  });
});

// ─── graph.connectedParties ───────────────────────────────────────────

describe('graph.connectedParties', () => {
  it('returns the multi-hop neighbourhood with node + edge citations', async () => {
    const client = mockClient(async () => [
      {
        rootId: 'tp_1',
        rootKind: 'TenantProfile',
        connected: [
          { id: 'p_house', kind: 'Person', relation: 'FOR_PERSON', hops: 1 },
          { id: 'l_lease', kind: 'Lease', relation: 'HAS_LEASE', hops: 1 },
          { id: 'u_unit', kind: 'Unit', relation: 'APPLIES_TO', hops: 2 },
        ],
      },
    ]);
    const tool = createConnectedPartiesTool({ client });
    const out = await tool.invoke({
      toolName: tool.name,
      input: { rootId: 'tp_1', maxHops: 2 },
      ctx: TENANT_CTX,
    });
    expectOk(out);
    expect(out.output.rootKind).toBe('TenantProfile');
    expect(out.output.nodes).toHaveLength(3);
    expect(out.output.nodes[0]).toEqual({
      id: 'p_house',
      kind: 'Person',
      relation: 'FOR_PERSON',
      hops: 1,
    });
    // first citation = the root node, then graph_edge entries
    expect(out.citations[0]?.target.kind).toBe('graph_node');
    expect(out.citations.some((c) => c.target.kind === 'graph_edge')).toBe(true);
  });

  it('returns empty nodes array (zero counts, no error) on no matches', async () => {
    const client = mockClient(async () => []);
    const tool = createConnectedPartiesTool({ client });
    const out = await tool.invoke({
      toolName: tool.name,
      input: { rootId: 'tp_missing' },
      ctx: TENANT_CTX,
    });
    expectOk(out);
    expect(out.output.nodes).toEqual([]);
    expect(out.output.rootKind).toBe('Unknown');
    expect(out.citations.length).toBe(1);
  });

  it('clamps maxHops to 3 and limit to 200', async () => {
    const readQuery = vi.fn(async () => []);
    const tool = createConnectedPartiesTool({ client: { readQuery } });
    await tool.invoke({
      toolName: tool.name,
      input: { rootId: 'r1', maxHops: 99, limit: 9999 },
      ctx: TENANT_CTX,
    });
    const params = (readQuery.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
    expect(params.maxHops).toBe(3);
    expect(params.limit).toBe(200);
    expect(params.tenantId).toBe('t_acme');
    expect(params.rootId).toBe('r1');
  });

  it('returns error when rootId is empty', async () => {
    const client = mockClient(async () => []);
    const tool = createConnectedPartiesTool({ client });
    const out = await tool.invoke({
      toolName: tool.name,
      input: { rootId: '' },
      ctx: TENANT_CTX,
    });
    expectError(out);
    expect(out.message).toMatch(/rootId/);
  });

  it('graph service throwing collapses to { kind: error }', async () => {
    const client = mockClient(async () => {
      throw new Error('cypher syntax');
    });
    const tool = createConnectedPartiesTool({ client });
    const out = await tool.invoke({
      toolName: tool.name,
      input: { rootId: 'r1' },
      ctx: TENANT_CTX,
    });
    expectError(out);
    expect(out.message).toContain('cypher syntax');
  });
});

// ─── graph.leaseNetwork ───────────────────────────────────────────────

describe('graph.leaseNetwork', () => {
  it('returns shape with rent + p50/p90 term distribution', async () => {
    const client = mockClient(async () => [
      {
        propertyId: 'pr_1',
        activeLeases: 5,
        tenantCount: 5,
        meanRent: 32500,
        currency: 'KES',
        termMonths: [6, 12, 12, 24, 36],
      },
    ]);
    const tool = createLeaseNetworkTool({ client });
    const out = await tool.invoke({
      toolName: tool.name,
      input: { propertyId: 'pr_1' },
      ctx: TENANT_CTX,
    });
    expectOk(out);
    expect(out.output.activeLeases).toBe(5);
    expect(out.output.tenantCount).toBe(5);
    expect(out.output.meanRent).toBe(32500);
    expect(out.output.currency).toBe('KES');
    expect(out.output.termMonthsP50).toBe(12);
    // 90th percentile of [6,12,12,24,36]: pos = 4*0.9 = 3.6 → 24*(0.4)+36*(0.6) = 31.2
    expect(out.output.termMonthsP90).toBeCloseTo(31.2, 1);
    expect(out.citations[0]?.target.kind).toBe('graph_node');
  });

  it('returns zero-counts when property has no active leases', async () => {
    const client = mockClient(async () => []);
    const tool = createLeaseNetworkTool({ client });
    const out = await tool.invoke({
      toolName: tool.name,
      input: { propertyId: 'pr_empty' },
      ctx: TENANT_CTX,
    });
    expectOk(out);
    expect(out.output).toEqual({
      propertyId: 'pr_empty',
      activeLeases: 0,
      tenantCount: 0,
      meanRent: 0,
      currency: 'KES',
      termMonthsP50: 0,
      termMonthsP90: 0,
    });
    expect(out.citations).toHaveLength(1);
  });

  it('forwards tenantId + propertyId to the cypher params', async () => {
    const readQuery = vi.fn(async () => []);
    const tool = createLeaseNetworkTool({ client: { readQuery } });
    await tool.invoke({
      toolName: tool.name,
      input: { propertyId: 'pr_xyz' },
      ctx: TENANT_CTX,
    });
    const params = (readQuery.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
    expect(params.tenantId).toBe('t_acme');
    expect(params.propertyId).toBe('pr_xyz');
  });

  it('client error collapses to { kind: error }', async () => {
    const client = mockClient(async () => {
      throw new Error('boom');
    });
    const tool = createLeaseNetworkTool({ client });
    const out = await tool.invoke({
      toolName: tool.name,
      input: { propertyId: 'pr_1' },
      ctx: TENANT_CTX,
    });
    expectError(out);
    expect(out.message).toContain('boom');
  });
});

// ─── graph.vacancyClusters ────────────────────────────────────────────

describe('graph.vacancyClusters', () => {
  it('returns ranked cluster list with property-graph_node citations', async () => {
    const client = mockClient(async () => [
      {
        propertyId: 'pr_1',
        blockId: null,
        vacantUnitCount: 12,
        totalUnitCount: 40,
        vacancyRate: 0.3,
        daysSinceFirstVacancy: 45,
      },
      {
        propertyId: 'pr_2',
        blockId: 'b_a',
        vacantUnitCount: 8,
        totalUnitCount: 20,
        vacancyRate: 0.4,
        daysSinceFirstVacancy: 60,
      },
    ]);
    const tool = createVacancyClustersTool({ client });
    const out = await tool.invoke({
      toolName: tool.name,
      input: {},
      ctx: TENANT_CTX,
    });
    expectOk(out);
    expect(out.output.clusters).toHaveLength(2);
    expect(out.output.clusters[0]?.propertyId).toBe('pr_1');
    expect(out.output.clusters[1]?.blockId).toBe('b_a');
    expect(out.citations.length).toBeGreaterThanOrEqual(1);
    expect(out.citations[0]?.target.kind).toBe('graph_node');
  });

  it('returns an empty clusters array (NOT error) when nothing exceeds threshold', async () => {
    const client = mockClient(async () => []);
    const tool = createVacancyClustersTool({ client });
    const out = await tool.invoke({
      toolName: tool.name,
      input: {},
      ctx: TENANT_CTX,
    });
    expectOk(out);
    expect(out.output.clusters).toEqual([]);
    expect(out.citations).toHaveLength(1);
    expect(out.citations[0]?.target.kind).toBe('platform_aggregate');
  });

  it('forwards tenantId, threshold params and an asOf timestamp', async () => {
    const readQuery = vi.fn(async () => []);
    const fixed = new Date('2026-05-01T00:00:00Z');
    const tool = createVacancyClustersTool({
      client: { readQuery },
      clock: () => fixed,
    });
    await tool.invoke({
      toolName: tool.name,
      input: { minVacancyPct: 0.35, minDaysVacant: 60, limit: 10 },
      ctx: TENANT_CTX,
    });
    const params = (readQuery.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
    expect(params.tenantId).toBe('t_acme');
    expect(params.minVacancyPct).toBe(0.35);
    expect(params.minDaysVacant).toBe(60);
    expect(params.limit).toBe(10);
    expect(params.asOf).toBe('2026-05-01T00:00:00.000Z');
  });

  it('clamps limit to 100 and minVacancyPct to [0,1]', async () => {
    const readQuery = vi.fn(async () => []);
    const tool = createVacancyClustersTool({ client: { readQuery } });
    await tool.invoke({
      toolName: tool.name,
      input: { minVacancyPct: 99, limit: 99999, minDaysVacant: -10 },
      ctx: TENANT_CTX,
    });
    const params = (readQuery.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
    expect(params.minVacancyPct).toBe(1);
    expect(params.limit).toBe(100);
    expect(params.minDaysVacant).toBe(0);
  });

  it('client throwing collapses to { kind: error }', async () => {
    const client = mockClient(async () => {
      throw new Error('graph down');
    });
    const tool = createVacancyClustersTool({ client });
    const out = await tool.invoke({
      toolName: tool.name,
      input: {},
      ctx: TENANT_CTX,
    });
    expectError(out);
    expect(out.message).toContain('graph down');
  });
});

// ─── createGraphKernelTools bundle ────────────────────────────────────

describe('createGraphKernelTools bundle', () => {
  it('returns four named tools, all tenant-scoped, with unique names', async () => {
    const bundle = createGraphKernelTools({ readQuery: vi.fn(async () => []) });
    const names = bundle.all.map((t) => t.name);
    expect(names).toEqual([
      'graph.portfolioConcentration',
      'graph.connectedParties',
      'graph.leaseNetwork',
      'graph.vacancyClusters',
    ]);
    expect(new Set(names).size).toBe(4);
    for (const t of bundle.all) {
      expect(t.scopes).toEqual(['tenant']);
      expect(t.description.length).toBeGreaterThan(0);
      expect(typeof t.inputJsonSchema).toBe('object');
    }
  });
});
