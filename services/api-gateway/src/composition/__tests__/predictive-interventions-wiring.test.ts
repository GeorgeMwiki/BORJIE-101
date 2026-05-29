/**
 * Unit tests for the predictive-interventions composition wiring.
 *
 * The DB-service layer is exercised via a stub Drizzle client that
 * records every call shape; we verify that the wiring correctly
 * adapts the DB service into the agent's
 * `PredictiveInterventionRepository` port.
 *
 * The agent itself is constructed for real (no mocks) so we also get
 * a smoke test that the cross-package types still align.
 *
 * Coverage:
 *   - listActiveTenants real Drizzle join (with feature projection)
 *   - listActiveTenants graceful empty + degraded-on-error contracts
 *   - insertPrediction / insertOpportunity / listRecentPredictions
 *   - LLM port adapter (Anthropic) + heuristic-baseline fallback
 *   - agentFor(tenantId) factory wires the LLM through end-to-end
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createPredictiveInterventionsWiring,
  __createRepoAdapterForTests,
  __createAnthropicClassifyPortForTests,
  narrowSignalType,
} from '../predictive-interventions-wiring';
import type {
  InterventionOpportunity,
  TenantFeatureSnapshot,
  TenantPrediction,
} from '@borjie/ai-copilot/ai-native';
import type { BudgetGuardedAnthropicClient } from '@borjie/ai-copilot';

// ---------------------------------------------------------------------------
// Stub Drizzle client — captures every chained call so we can assert the
// shape passed in by the DB service. Models the chains the
// `tenant-predictions.service` AND `listActiveTenants` join actually uses.
//
// `__nextRowsByCallIndex` lets a test queue per-`limit`/per-terminal-await
// row sets so a multi-query pipeline (listActiveTenants joins ~7 tables)
// can return distinct rows for each leg in order.
// ---------------------------------------------------------------------------

interface StubCall {
  readonly method: string;
  readonly args: ReadonlyArray<unknown>;
}

interface StubDb {
  readonly __calls: StubCall[];
  __nextRows: ReadonlyArray<Record<string, unknown>>;
  __nextRowsQueue: Array<ReadonlyArray<Record<string, unknown>>>;
  insert(table: unknown): StubChain;
  select(_columns?: unknown): StubChain;
}

interface StubChain extends PromiseLike<ReadonlyArray<Record<string, unknown>>> {
  values(args: unknown): Promise<void>;
  from(table: unknown): StubChain;
  innerJoin(table: unknown, cond: unknown): StubChain;
  where(cond: unknown): StubChain;
  orderBy(arg: unknown): StubChain;
  groupBy(arg: unknown): StubChain;
  limit(n: number): Promise<ReadonlyArray<Record<string, unknown>>>;
}

function createStubDb(): StubDb {
  const calls: StubCall[] = [];
  const state: {
    nextRows: ReadonlyArray<Record<string, unknown>>;
    nextRowsQueue: Array<ReadonlyArray<Record<string, unknown>>>;
  } = {
    nextRows: [],
    nextRowsQueue: [],
  };

  function popRows(): ReadonlyArray<Record<string, unknown>> {
    if (state.nextRowsQueue.length > 0) {
      return state.nextRowsQueue.shift() ?? [];
    }
    const rows = state.nextRows;
    state.nextRows = [];
    return rows;
  }

  const chain: StubChain = {
    async values(args) {
      calls.push({ method: 'values', args: [args] });
    },
    from(table) {
      calls.push({ method: 'from', args: [table] });
      return chain;
    },
    innerJoin(table, cond) {
      calls.push({ method: 'innerJoin', args: [table, cond] });
      return chain;
    },
    where(cond) {
      calls.push({ method: 'where', args: [cond] });
      return chain;
    },
    orderBy(arg) {
      calls.push({ method: 'orderBy', args: [arg] });
      return chain;
    },
    groupBy(arg) {
      calls.push({ method: 'groupBy', args: [arg] });
      return chain;
    },
    async limit(n) {
      calls.push({ method: 'limit', args: [n] });
      return popRows();
    },
    // Make the chain awaitable so `await db.select(...).from(...)` resolves
    // to the next queued row set without an explicit `.limit(...)` on every
    // listActiveTenants leg.
    then<TResult1 = ReadonlyArray<Record<string, unknown>>, TResult2 = never>(
      onfulfilled?:
        | ((
            value: ReadonlyArray<Record<string, unknown>>,
          ) => TResult1 | PromiseLike<TResult1>)
        | null
        | undefined,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null
        | undefined,
    ): PromiseLike<TResult1 | TResult2> {
      const rows = popRows();
      return Promise.resolve(rows).then(onfulfilled, onrejected);
    },
  };

  return {
    __calls: calls,
    get __nextRows() {
      return state.nextRows;
    },
    set __nextRows(rows: ReadonlyArray<Record<string, unknown>>) {
      state.nextRows = rows;
    },
    get __nextRowsQueue() {
      return state.nextRowsQueue;
    },
    set __nextRowsQueue(rows: Array<ReadonlyArray<Record<string, unknown>>>) {
      state.nextRowsQueue = rows;
    },
    insert(table) {
      calls.push({ method: 'insert', args: [table] });
      return chain;
    },
    select(_columns?: unknown) {
      calls.push({ method: 'select', args: _columns ? [_columns] : [] });
      return chain;
    },
  };
}

// `as never` because the stub does not satisfy the full Drizzle surface;
// it only models the chains the production code actually uses.
function asDb(stub: StubDb): never {
  return stub as never;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date('2026-05-08T00:00:00.000Z');
const fakeNow = () => FIXED_NOW;

const SAMPLE_PREDICTION: TenantPrediction = {
  id: 'tp_test_1',
  tenantId: 'tenant-7',
  customerId: 'customer-42',
  horizonDays: 30,
  probPayOnTime: 0.7,
  probPayLate: 0.2,
  probDefault: 0.05,
  probChurn: 0.1,
  probDispute: 0.03,
  modelVersion: 'degraded-baseline-v1',
  confidence: 0.35,
  explanation: 'Rule-based baseline (LLM unavailable); confidence reduced.',
  featureSnapshot: { paymentOnTimeRate: 0.9 },
  promptHash: 'abc123',
  computedAt: '2026-05-08T00:00:00.000Z',
};

const SAMPLE_OPPORTUNITY: InterventionOpportunity = {
  id: 'pio_test_1',
  tenantId: 'tenant-7',
  customerId: 'customer-42',
  predictionId: 'tp_test_1',
  signalType: 'high_default_risk',
  signalStrength: 0.8,
  suggestedAction: 'Offer payment plan.',
  status: 'open',
  metadata: {},
  createdAt: '2026-05-08T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createPredictiveInterventionsWiring', () => {
  let stub: StubDb;
  let logger: { warn: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    stub = createStubDb();
    logger = { warn: vi.fn() };
  });

  it('returns null when db is null', () => {
    const wiring = createPredictiveInterventionsWiring({
      db: null,
      logger,
    });
    expect(wiring).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('returns wiring with .agent and .agentFor when db is present', () => {
    const wiring = createPredictiveInterventionsWiring({
      db: asDb(stub),
      logger,
      now: fakeNow,
    });
    expect(wiring).not.toBeNull();
    expect(wiring!.agent).toBeDefined();
    expect(typeof wiring!.agentFor).toBe('function');
    expect(typeof wiring!.agent.predictOne).toBe('function');
    expect(typeof wiring!.agent.runNightly).toBe('function');
    expect(typeof wiring!.agent.listRecent).toBe('function');
    // agentFor without an LLM factory falls back to the baseline agent.
    const tenantAgent = wiring!.agentFor('tenant-7');
    expect(tenantAgent).toBe(wiring!.agent);
  });

  it('listActiveTenants returns [] when no active leases exist', async () => {
    // First leg (active leases) returns nothing → short-circuit to [].
    stub.__nextRowsQueue = [[]];
    const repo = __createRepoAdapterForTests(asDb(stub), fakeNow, logger);
    const result = await repo.listActiveTenants('tenant-7');
    expect(result).toEqual([]);
  });

  it('listActiveTenants returns [] when tenantId is empty', async () => {
    const repo = __createRepoAdapterForTests(asDb(stub), fakeNow, logger);
    const result = await repo.listActiveTenants('');
    expect(result).toEqual([]);
  });

  // R4 TODO 2026-05-29 — `predictive-interventions-wiring.ts` queries
  // the BossNyumba `leases` / `customers` / property-side tables that
  // were pruned in the mining hard-fork; the wiring catches and logs
  // the empty-result so [] is the only observable outcome. The
  // underlying DB services for predictions / opportunities are also
  // mining-rewrite-pending stubs. Skip until retargeted onto the
  // mining-domain signal tables.
  it.skip('listActiveTenants projects per-customer feature snapshots', async () => {
    // Arrange the multi-leg pipeline. Order matches the implementation:
    //   1. active leases  → 2 customers
    //   2. payment totals 6m → ontime/total per customer
    //   3. arrears        → daysPastDue per customer
    //   4. credit         → numericScore per customer
    //   5. open cases     → count per customer
    //   6. dispute cases  → count per customer
    //   7. intelligence_history → sentiment + churn
    stub.__nextRowsQueue = [
      // 1. active leases
      [
        {
          customerId: 'cust-A',
          startDate: new Date('2025-05-08T00:00:00.000Z'), // 12 months ago
        },
        {
          customerId: 'cust-B',
          startDate: new Date('2025-11-08T00:00:00.000Z'), // 6 months ago
        },
      ],
      // 2. payment totals
      [
        { customerId: 'cust-A', total: 10, ontime: 9 },
        { customerId: 'cust-B', total: 4, ontime: 1 },
      ],
      // 3. arrears
      [{ customerId: 'cust-B', daysPastDue: 45 }],
      // 4. credit
      [
        { customerId: 'cust-A', numericScore: 720, computedAt: FIXED_NOW },
        { customerId: 'cust-B', numericScore: 540, computedAt: FIXED_NOW },
      ],
      // 5. open cases
      [{ customerId: 'cust-B', count: 2 }],
      // 6. disputes 90d
      [{ customerId: 'cust-B', count: 1 }],
      // 7. intelligence_history
      [
        {
          customerId: 'cust-A',
          sentimentScore: 0.4,
          churnRiskScore: 10,
          snapshotDate: '2026-05-07',
        },
        {
          customerId: 'cust-B',
          sentimentScore: -0.6,
          churnRiskScore: 70,
          snapshotDate: '2026-05-07',
        },
      ],
    ];

    const repo = __createRepoAdapterForTests(asDb(stub), fakeNow, logger);
    const result = await repo.listActiveTenants('tenant-7');

    expect(result).toHaveLength(2);
    const a = result.find((r) => r.customerId === 'cust-A')!;
    const b = result.find((r) => r.customerId === 'cust-B')!;

    expect(a.tenantId).toBe('tenant-7');
    expect(a.paymentOnTimeRate).toBeCloseTo(0.9);
    expect(a.arrearsDays).toBeNull();
    expect(a.creditScore).toBe(720);
    expect(a.tenancyMonths).toBe(12);
    expect(a.openCases).toBe(0);
    expect(a.rollingSentiment).toBeCloseTo(0.4);
    expect(a.churnSignalAvg).toBeCloseTo(0.1);
    expect(a.disputeCount90d).toBe(0);

    expect(b.paymentOnTimeRate).toBeCloseTo(0.25);
    expect(b.arrearsDays).toBe(45);
    expect(b.creditScore).toBe(540);
    expect(b.tenancyMonths).toBe(6);
    expect(b.openCases).toBe(2);
    expect(b.rollingSentiment).toBeCloseTo(-0.6);
    expect(b.churnSignalAvg).toBeCloseTo(0.7);
    expect(b.disputeCount90d).toBe(1);
  });

  // R4 TODO 2026-05-29 — vestigial property tables; see preceding skip.
  it.skip('listActiveTenants returns nulls gracefully when signal tables are empty', async () => {
    stub.__nextRowsQueue = [
      // 1. active leases
      [{ customerId: 'cust-X', startDate: new Date('2026-04-08T00:00:00.000Z') }],
      // 2-7. empty downstream legs
      [],
      [],
      [],
      [],
      [],
      [],
    ];
    const repo = __createRepoAdapterForTests(asDb(stub), fakeNow, logger);
    const result = await repo.listActiveTenants('tenant-7');

    expect(result).toHaveLength(1);
    const x = result[0]!;
    expect(x.paymentOnTimeRate).toBeNull();
    expect(x.arrearsDays).toBeNull();
    expect(x.creditScore).toBeNull();
    expect(x.tenancyMonths).toBe(1);
    expect(x.openCases).toBe(0);
    expect(x.rollingSentiment).toBeNull();
    expect(x.churnSignalAvg).toBeNull();
    expect(x.disputeCount90d).toBe(0);
  });

  it('listActiveTenants degrades to [] and logs on query error', async () => {
    // Force the first leg to throw.
    const errorDb = {
      ...createStubDb(),
      select() {
        throw new Error('drizzle-down');
      },
    };
    const repo = __createRepoAdapterForTests(asDb(errorDb), fakeNow, logger);
    const result = await repo.listActiveTenants('tenant-7');
    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-7' }),
      expect.stringContaining('listActiveTenants'),
    );
  });

  // R4 TODO 2026-05-29 — predictions service is a mining-rewrite-pending stub.
  it.skip('insertPrediction delegates to the DB service (issues an insert with the right values)', async () => {
    const repo = __createRepoAdapterForTests(asDb(stub), fakeNow, logger);
    const out = await repo.insertPrediction(SAMPLE_PREDICTION);
    expect(out.id).toBe(SAMPLE_PREDICTION.id);

    const insertCall = stub.__calls.find((c) => c.method === 'insert');
    const valuesCall = stub.__calls.find((c) => c.method === 'values');
    expect(insertCall).toBeDefined();
    expect(valuesCall).toBeDefined();
    const values = valuesCall!.args[0] as Record<string, unknown>;
    expect(values.id).toBe(SAMPLE_PREDICTION.id);
    expect(values.tenantId).toBe(SAMPLE_PREDICTION.tenantId);
    expect(values.customerId).toBe(SAMPLE_PREDICTION.customerId);
    expect(values.probPayOnTime).toBe(SAMPLE_PREDICTION.probPayOnTime);
    expect(values.probDefault).toBe(SAMPLE_PREDICTION.probDefault);
    expect(values.modelVersion).toBe(SAMPLE_PREDICTION.modelVersion);
  });

  // R4 TODO 2026-05-29 — opportunities service is a mining-rewrite-pending stub.
  it.skip('insertOpportunity delegates to the DB service and preserves the union signalType', async () => {
    const repo = __createRepoAdapterForTests(asDb(stub), fakeNow, logger);
    const out = await repo.insertOpportunity(SAMPLE_OPPORTUNITY);
    expect(out.id).toBe(SAMPLE_OPPORTUNITY.id);
    expect(out.signalType).toBe('high_default_risk');

    const valuesCall = stub.__calls.find((c) => c.method === 'values');
    const values = valuesCall!.args[0] as Record<string, unknown>;
    expect(values.signalType).toBe('high_default_risk');
    expect(values.signalStrength).toBe(SAMPLE_OPPORTUNITY.signalStrength);
    expect(values.status).toBe('open');
  });

  // R4 TODO 2026-05-29 — predictions service is a mining-rewrite-pending stub.
  it.skip('listRecentPredictions round-trips rows through the DB service', async () => {
    stub.__nextRows = [
      {
        id: 'tp_db_1',
        tenantId: 'tenant-7',
        customerId: 'customer-42',
        horizonDays: 30,
        probPayOnTime: '0.7',
        probPayLate: '0.2',
        probDefault: '0.05',
        probChurn: '0.1',
        probDispute: '0.03',
        modelVersion: 'degraded-baseline-v1',
        confidence: '0.35',
        explanation: 'baseline',
        featureSnapshot: { x: 1 },
        promptHash: 'hash-1',
        computedAt: new Date('2026-05-08T00:00:00.000Z'),
      },
    ];

    const repo = __createRepoAdapterForTests(asDb(stub), fakeNow, logger);
    const rows = await repo.listRecentPredictions('tenant-7', 'customer-42');
    expect(rows.length).toBe(1);
    expect(rows[0]?.id).toBe('tp_db_1');
    expect(rows[0]?.probPayOnTime).toBe(0.7);
    expect(rows[0]?.horizonDays).toBe(30);
    expect(rows[0]?.computedAt).toBe('2026-05-08T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// LLM port adapter tests
// ---------------------------------------------------------------------------

describe('Anthropic ClassifyLLMPort adapter', () => {
  function createStubAnthropicClient(
    raw: string,
    inputTokens = 12,
    outputTokens = 34,
  ): BudgetGuardedAnthropicClient {
    const create = vi.fn(async () => ({
      content: [{ type: 'text', text: raw }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      },
    }));
    return Object.freeze({
      defaultModel: 'claude-sonnet-4-6',
      sdk: {
        messages: { create },
      },
    } as unknown as BudgetGuardedAnthropicClient);
  }

  it('parses Anthropic content blocks into a raw JSON string', async () => {
    const raw = JSON.stringify({
      probPayOnTime: 0.7,
      probPayLate: 0.2,
      probDefault: 0.05,
      probChurn: 0.05,
      probDispute: 0.05,
      confidence: 0.8,
      explanation: 'low risk',
    });
    const client = createStubAnthropicClient(raw);
    const port = __createAnthropicClassifyPortForTests(client);
    const out = await port.classify({
      systemPrompt: 'You are a risk model',
      userPrompt: 'Score this tenant',
    });
    expect(out.raw).toBe(raw);
    expect(out.modelVersion).toBe('claude-sonnet-4-6');
    expect(out.inputTokens).toBe(12);
    expect(out.outputTokens).toBe(34);
  });

  it('agentFor(tenantId) wires the LLM end-to-end through predictOne', async () => {
    const stub = createStubDb();
    const logger = { warn: vi.fn() };
    const llmRaw = JSON.stringify({
      probPayOnTime: 0.1,
      probPayLate: 0.2,
      probDefault: 0.6,
      probChurn: 0.7,
      probDispute: 0.5,
      confidence: 0.9,
      explanation: 'tenant exhibits elevated default + churn signals',
    });
    const create = vi.fn(async () => ({
      content: [{ type: 'text', text: llmRaw }],
      usage: { input_tokens: 50, output_tokens: 100 },
    }));
    const factory = vi.fn(
      (_tenantId: string, _operation?: string): BudgetGuardedAnthropicClient =>
        Object.freeze({
          defaultModel: 'claude-sonnet-4-6',
          sdk: { messages: { create } },
        } as unknown as BudgetGuardedAnthropicClient),
    );

    const wiring = createPredictiveInterventionsWiring({
      db: asDb(stub),
      logger,
      anthropicClientFactory: factory,
      now: fakeNow,
    });
    expect(wiring).not.toBeNull();
    const tenantAgent = wiring!.agentFor('tenant-7');
    // Distinct from the baseline agent because the LLM is wired in.
    expect(tenantAgent).not.toBe(wiring!.agent);

    const features: TenantFeatureSnapshot = {
      tenantId: 'tenant-7',
      customerId: 'cust-A',
      paymentOnTimeRate: 0.5,
      arrearsDays: 30,
      creditScore: 580,
      tenancyMonths: 9,
      openCases: 1,
      rollingSentiment: -0.4,
      churnSignalAvg: 0.6,
      disputeCount90d: 1,
    };
    const out = await tenantAgent.predictOne(features, 30);
    expect(factory).toHaveBeenCalledWith(
      'tenant-7',
      'predictive-interventions:predict',
    );
    expect(create).toHaveBeenCalled();
    expect(out.modelVersion).toBe('claude-sonnet-4-6');
    expect(out.probDefault).toBeCloseTo(0.6);
    expect(out.confidence).toBeCloseTo(0.9);
    expect(out.explanation).toMatch(/elevated/i);
  });

  it('agentFor falls back to the heuristic baseline when LLM raw is unparseable', async () => {
    const stub = createStubDb();
    const create = vi.fn(async () => ({
      content: [{ type: 'text', text: 'not json' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const factory = vi.fn(
      (): BudgetGuardedAnthropicClient =>
        Object.freeze({
          defaultModel: 'claude-sonnet-4-6',
          sdk: { messages: { create } },
        } as unknown as BudgetGuardedAnthropicClient),
    );
    const wiring = createPredictiveInterventionsWiring({
      db: asDb(stub),
      anthropicClientFactory: factory,
      now: fakeNow,
    });
    const tenantAgent = wiring!.agentFor('tenant-7');
    const features: TenantFeatureSnapshot = {
      tenantId: 'tenant-7',
      customerId: 'cust-A',
      paymentOnTimeRate: 0.9,
      arrearsDays: 0,
      creditScore: 720,
      tenancyMonths: 12,
      openCases: 0,
      rollingSentiment: 0.2,
      churnSignalAvg: 0.1,
      disputeCount90d: 0,
    };
    const out = await tenantAgent.predictOne(features, 30);
    // safeJsonParse → null, agent falls back to degraded baseline.
    expect(out.modelVersion).toBe('degraded-no-llm');
    expect(out.confidence).toBeLessThan(0.5);
  });

  it('agentFor returns the heuristic agent when no factory is supplied', () => {
    const stub = createStubDb();
    const wiring = createPredictiveInterventionsWiring({
      db: asDb(stub),
      anthropicClientFactory: null,
      now: fakeNow,
    });
    expect(wiring!.agentFor('tenant-7')).toBe(wiring!.agent);
  });
});

describe('narrowSignalType', () => {
  it('preserves all four valid signal types', () => {
    expect(narrowSignalType('high_default_risk')).toBe('high_default_risk');
    expect(narrowSignalType('high_churn_risk')).toBe('high_churn_risk');
    expect(narrowSignalType('high_dispute_risk')).toBe('high_dispute_risk');
    expect(narrowSignalType('sentiment_collapse')).toBe('sentiment_collapse');
  });

  it('falls back to high_default_risk for unknown values', () => {
    expect(narrowSignalType('unknown_signal')).toBe('high_default_risk');
    expect(narrowSignalType('')).toBe('high_default_risk');
  });
});
