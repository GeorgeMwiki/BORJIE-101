/**
 * AI Cost Ledger tests — Wave 9 enterprise polish.
 *
 * Covers:
 *   - recordUsage() appends entries and never mutates prior rows
 *   - currentMonthSpend() sums within the UTC calendar month
 *   - isOverBudget() / assertWithinBudget() trigger when at-or-over cap
 *   - AiBudgetExceededError carries budget + current-spend metadata
 *   - hardStop=false disables enforcement (spend still tracked)
 *   - budget unset → never over budget
 *   - cross-tenant isolation (tenant A's spend doesn't leak to tenant B)
 *   - budget-guarded Anthropic client short-circuits over-budget calls
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createCostLedger,
  AiBudgetExceededError,
  CostLedgerError,
  startOfMonthUtc,
  startOfNextMonthUtc,
  type AiCostEntry,
  type CostLedgerRepository,
  type TenantAiBudget,
} from '../cost-ledger.js';
import { withBudgetGuard } from '../providers/budget-guard.js';
import type {
  AnthropicClient,
  AnthropicSdkLike,
  AnthropicMessageResponse,
} from '../providers/anthropic-client.js';

function makeRepo(): {
  repo: CostLedgerRepository;
  entries: AiCostEntry[];
  budgets: Map<string, TenantAiBudget>;
} {
  const entries: AiCostEntry[] = [];
  const budgets = new Map<string, TenantAiBudget>();
  const repo: CostLedgerRepository = {
    async insertEntry(entry) {
      entries.push({ ...entry });
      return { ...entry };
    },
    async sumUsage(tenantId, from, to) {
      const fromMs = from.getTime();
      const toMs = to.getTime();
      const scoped = entries.filter((e) => {
        if (e.tenantId !== tenantId) return false;
        const t = new Date(e.occurredAt).getTime();
        return t >= fromMs && t < toMs;
      });
      const byModel: Record<string, { cost: number; calls: number }> = {};
      let totalCost = 0;
      let totalIn = 0;
      let totalOut = 0;
      for (const e of scoped) {
        totalCost += e.costUsdMicro;
        totalIn += e.inputTokens;
        totalOut += e.outputTokens;
        if (!byModel[e.model]) byModel[e.model] = { cost: 0, calls: 0 };
        byModel[e.model].cost += e.costUsdMicro;
        byModel[e.model].calls += 1;
      }
      return {
        totalCostUsdMicro: totalCost,
        totalInputTokens: totalIn,
        totalOutputTokens: totalOut,
        callCount: scoped.length,
        byModel,
      };
    },
    async listRecent(tenantId, limit) {
      return entries
        .filter((e) => e.tenantId === tenantId)
        .slice(-limit)
        .reverse()
        .map((e) => ({ ...e }));
    },
    async getBudget(tenantId) {
      const b = budgets.get(tenantId);
      return b ? { ...b } : null;
    },
    async upsertBudget(budget) {
      budgets.set(budget.tenantId, { ...budget });
      return { ...budget };
    },
  };
  return { repo, entries, budgets };
}

const fixedNow = () => new Date('2026-04-19T12:00:00.000Z');
let idCounter = 0;
function resetIds() {
  idCounter = 0;
}
function fixedId() {
  return `aic_${++idCounter}`;
}

describe('startOfMonthUtc / startOfNextMonthUtc', () => {
  it('returns UTC boundaries', () => {
    const d = new Date('2026-04-19T12:34:56.789Z');
    expect(startOfMonthUtc(d).toISOString()).toBe(
      '2026-04-01T00:00:00.000Z',
    );
    expect(startOfNextMonthUtc(d).toISOString()).toBe(
      '2026-05-01T00:00:00.000Z',
    );
  });

  it('handles December rollover', () => {
    const d = new Date('2026-12-31T23:59:59.999Z');
    expect(startOfNextMonthUtc(d).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });
});

describe('CostLedger.recordUsage', () => {
  beforeEach(() => resetIds());

  it('appends a new entry with non-zero tokens + cost', async () => {
    const { repo, entries } = makeRepo();
    const ledger = createCostLedger({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });
    const entry = await ledger.recordUsage({
      tenantId: 'tenant_a',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 200,
      costUsdMicro: 5000,
      operation: 'triage',
    });
    expect(entry.id).toBe('aic_1');
    expect(entry.tenantId).toBe('tenant_a');
    expect(entry.inputTokens).toBe(100);
    expect(entry.costUsdMicro).toBe(5000);
    expect(entries).toHaveLength(1);
  });

  it('preserves prior rows (append-only)', async () => {
    const { repo, entries } = makeRepo();
    const ledger = createCostLedger({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });
    await ledger.recordUsage({
      tenantId: 'tenant_a',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      inputTokens: 10,
      outputTokens: 20,
      costUsdMicro: 500,
    });
    await ledger.recordUsage({
      tenantId: 'tenant_a',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      inputTokens: 5,
      outputTokens: 5,
      costUsdMicro: 100,
    });
    expect(entries).toHaveLength(2);
    // First row unchanged.
    expect(entries[0].inputTokens).toBe(10);
  });

  it('rejects negative tokens', async () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });
    await expect(
      ledger.recordUsage({
        tenantId: 'tenant_a',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        inputTokens: -1,
        outputTokens: 0,
        costUsdMicro: 0,
      }),
    ).rejects.toBeInstanceOf(CostLedgerError);
  });
});

describe('CostLedger.currentMonthSpend', () => {
  beforeEach(() => resetIds());

  it('sums only rows in the current UTC month', async () => {
    const { repo, entries } = makeRepo();
    // Inject an older row directly via the repo.
    entries.push({
      id: 'old_1',
      tenantId: 'tenant_a',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      inputTokens: 999,
      outputTokens: 999,
      costUsdMicro: 999_999,
      operation: null,
      correlationId: null,
      metadata: {},
      occurredAt: '2026-03-15T00:00:00.000Z', // PREV month
      createdAt: '2026-03-15T00:00:00.000Z',
    });

    const ledger = createCostLedger({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });
    await ledger.recordUsage({
      tenantId: 'tenant_a',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      inputTokens: 10,
      outputTokens: 20,
      costUsdMicro: 500,
    });
    const summary = await ledger.currentMonthSpend('tenant_a');
    // March row excluded.
    expect(summary.totalCostUsdMicro).toBe(500);
    expect(summary.callCount).toBe(1);
    expect(summary.periodStart).toBe('2026-04-01T00:00:00.000Z');
    expect(summary.periodEnd).toBe('2026-05-01T00:00:00.000Z');
  });

  it('groups spend by model', async () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });
    await ledger.recordUsage({
      tenantId: 'tenant_a',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      inputTokens: 10,
      outputTokens: 20,
      costUsdMicro: 500,
    });
    await ledger.recordUsage({
      tenantId: 'tenant_a',
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 5,
      outputTokens: 5,
      costUsdMicro: 100,
    });
    const summary = await ledger.currentMonthSpend('tenant_a');
    expect(summary.byModel['claude-sonnet-4-6']).toEqual({
      cost: 500,
      calls: 1,
    });
    expect(summary.byModel['claude-haiku-4-5-20251001']).toEqual({
      cost: 100,
      calls: 1,
    });
  });
});

describe('CostLedger.isOverBudget / assertWithinBudget', () => {
  beforeEach(() => resetIds());

  it('false when no budget configured', async () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });
    await expect(ledger.isOverBudget('tenant_a')).resolves.toBe(false);
    await expect(
      ledger.assertWithinBudget('tenant_a'),
    ).resolves.toBeUndefined();
  });

  it('true when spend equals cap (≥ comparison)', async () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });
    await ledger.setBudget('tenant_a', 1000, { hardStop: true });
    await ledger.recordUsage({
      tenantId: 'tenant_a',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      inputTokens: 10,
      outputTokens: 20,
      costUsdMicro: 1000,
    });
    await expect(ledger.isOverBudget('tenant_a')).resolves.toBe(true);
    await expect(
      ledger.assertWithinBudget('tenant_a'),
    ).rejects.toBeInstanceOf(AiBudgetExceededError);
  });

  it('hardStop=false does not block even when over cap', async () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });
    await ledger.setBudget('tenant_a', 500, { hardStop: false });
    await ledger.recordUsage({
      tenantId: 'tenant_a',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      inputTokens: 10,
      outputTokens: 20,
      costUsdMicro: 10_000,
    });
    await expect(ledger.isOverBudget('tenant_a')).resolves.toBe(false);
    await expect(
      ledger.assertWithinBudget('tenant_a'),
    ).resolves.toBeUndefined();
  });

  it('AiBudgetExceededError carries spend + cap metadata', async () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });
    await ledger.setBudget('tenant_a', 800, { hardStop: true });
    await ledger.recordUsage({
      tenantId: 'tenant_a',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      inputTokens: 10,
      outputTokens: 20,
      costUsdMicro: 1200,
    });
    try {
      await ledger.assertWithinBudget('tenant_a');
      expect.fail('expected AiBudgetExceededError');
    } catch (e) {
      expect(e).toBeInstanceOf(AiBudgetExceededError);
      if (e instanceof AiBudgetExceededError) {
        expect(e.tenantId).toBe('tenant_a');
        expect(e.monthlyCapUsdMicro).toBe(800);
        expect(e.currentSpendUsdMicro).toBe(1200);
      }
    }
  });
});

describe('CostLedger cross-tenant isolation', () => {
  beforeEach(() => resetIds());

  it("tenant A's spend does not affect tenant B's budget", async () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });
    await ledger.setBudget('tenant_a', 500, { hardStop: true });
    await ledger.setBudget('tenant_b', 500, { hardStop: true });

    await ledger.recordUsage({
      tenantId: 'tenant_a',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      inputTokens: 10,
      outputTokens: 20,
      costUsdMicro: 500, // A is now at cap
    });

    await expect(ledger.isOverBudget('tenant_a')).resolves.toBe(true);
    await expect(ledger.isOverBudget('tenant_b')).resolves.toBe(false);

    const summaryA = await ledger.currentMonthSpend('tenant_a');
    const summaryB = await ledger.currentMonthSpend('tenant_b');
    expect(summaryA.totalCostUsdMicro).toBe(500);
    expect(summaryB.totalCostUsdMicro).toBe(0);
  });
});

describe('withBudgetGuard', () => {
  beforeEach(() => resetIds());

  function makeAnthropicStub(): {
    client: AnthropicClient;
    create: ReturnType<typeof vi.fn>;
  } {
    const create = vi.fn(async (_req: unknown) => {
      const resp: AnthropicMessageResponse = {
        content: [{ type: 'text', text: '{"ok":true}' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 50, output_tokens: 100 },
      };
      return resp;
    });
    const sdk: AnthropicSdkLike = {
      messages: {
        create: create as unknown as AnthropicSdkLike['messages']['create'],
      },
    };
    const client: AnthropicClient = {
      defaultModel: 'claude-sonnet-4-6',
      sdk,
    };
    return { client, create };
  }

  it('records usage on successful call', async () => {
    const { repo, entries } = makeRepo();
    const ledger = createCostLedger({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });
    const { client, create } = makeAnthropicStub();
    const guarded = withBudgetGuard(client, {
      ledger,
      context: () => ({ tenantId: 'tenant_a', operation: 'triage' }),
      priceEstimator: ({ inputTokens, outputTokens }) =>
        inputTokens * 1 + outputTokens * 2, // toy price
    });
    await guarded.sdk.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(entries).toHaveLength(1);
    expect(entries[0].tenantId).toBe('tenant_a');
    expect(entries[0].operation).toBe('triage');
    // 50 * 1 + 100 * 2 = 250 micro
    expect(entries[0].costUsdMicro).toBe(250);
  });

  it('throws AiBudgetExceededError BEFORE hitting the SDK when over cap', async () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });
    await ledger.setBudget('tenant_a', 100, { hardStop: true });
    await ledger.recordUsage({
      tenantId: 'tenant_a',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      inputTokens: 10,
      outputTokens: 20,
      costUsdMicro: 200, // over cap already
    });

    const { client, create } = makeAnthropicStub();
    const guarded = withBudgetGuard(client, {
      ledger,
      context: () => ({ tenantId: 'tenant_a' }),
    });

    await expect(
      guarded.sdk.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toBeInstanceOf(AiBudgetExceededError);

    // The underlying SDK was NOT called — the guard short-circuited.
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects calls whose context has no tenantId', async () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({
      repo,
      now: fixedNow,
      idGenerator: fixedId,
    });
    const { client } = makeAnthropicStub();
    const guarded = withBudgetGuard(client, {
      ledger,
      context: () => ({ tenantId: '' }),
    });
    await expect(
      guarded.sdk.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow(/tenantId/);
  });
});
