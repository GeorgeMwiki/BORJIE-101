/**
 * Tests for cost-cap/.
 *
 * Coverage:
 *   - preflight allows when budget remaining
 *   - preflight blocks when projected > remaining
 *   - preflight blocks when killSwitch active
 *   - warning event emitted near threshold
 *   - exceeded event emitted on block
 *   - postflight charges and ledger reflects
 *   - month-to-date accumulates across charges
 */

import { describe, expect, it } from 'vitest';
import {
  preflightCostCheck,
  postflightCharge,
  InMemorySpendLedger,
  type CostCapEvent,
  type TenantBudget,
} from './cost-cap.js';
import type { BrainLLMRequest, BrainLLMResponse } from '../types.js';

function budgetReader(budget: TenantBudget): { read: () => Promise<TenantBudget> } {
  return { read: async () => budget };
}

const baseReq: BrainLLMRequest = {
  model: 'anthropic/claude-haiku-4-5',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  maxTokens: 100,
};

const ctx = { tenantId: 'tnt_1', conversationId: 'conv_a', model: 'anthropic/claude-haiku-4-5' };

describe('preflightCostCheck', () => {
  it('allows when budget remaining', async () => {
    const ledger = new InMemorySpendLedger();
    const result = await preflightCostCheck(baseReq, ctx, {
      budgetReader: budgetReader({ tenantId: 'tnt_1', monthlyBudgetUsd: 100, conversationBudgetUsd: 1 }),
      ledger,
    });
    expect(result.projectedUsd).toBeGreaterThan(0);
    expect(result.projectedUsd).toBeLessThan(1);
    expect(result.monthlyRemainingUsd).toBe(100);
  });

  it('blocks when projected > conversation budget', async () => {
    const ledger = new InMemorySpendLedger();
    await expect(
      preflightCostCheck(
        { ...baseReq, model: 'anthropic/claude-opus-4-7', maxTokens: 100_000 },
        { ...ctx, model: 'anthropic/claude-opus-4-7' },
        {
          budgetReader: budgetReader({
            tenantId: 'tnt_1',
            monthlyBudgetUsd: 100,
            conversationBudgetUsd: 0.01,
          }),
          ledger,
        }
      )
    ).rejects.toMatchObject({ code: 'COST_CAP_EXCEEDED' });
  });

  it('blocks when killSwitch active', async () => {
    const ledger = new InMemorySpendLedger();
    await expect(
      preflightCostCheck(baseReq, ctx, {
        budgetReader: budgetReader({ tenantId: 'tnt_1', monthlyBudgetUsd: 100, conversationBudgetUsd: 1 }),
        ledger,
        killSwitch: { isBlocked: async () => true },
      })
    ).rejects.toMatchObject({ code: 'TENANT_BLOCKED' });
  });

  it('emits exceeded event when blocked', async () => {
    const events: CostCapEvent[] = [];
    const ledger = new InMemorySpendLedger();
    await expect(
      preflightCostCheck(
        { ...baseReq, model: 'anthropic/claude-opus-4-7', maxTokens: 100_000 },
        { ...ctx, model: 'anthropic/claude-opus-4-7' },
        {
          budgetReader: budgetReader({ tenantId: 'tnt_1', monthlyBudgetUsd: 100, conversationBudgetUsd: 0.001 }),
          ledger,
          onEvent: (e) => events.push(e),
        }
      )
    ).rejects.toMatchObject({ code: 'COST_CAP_EXCEEDED' });
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'cost-cap-exceeded')).toBe(true);
  });

  it('emits warning event near threshold', async () => {
    const events: CostCapEvent[] = [];
    const ledger = new InMemorySpendLedger();
    // Haiku projected: 1 input token + 100 output tokens
    //   = (1/1e6)*1 + (100/1e6)*5 = 0.000501 USD
    // Warn when projected > 0.85 * remaining. Set conversation budget to
    // 0.00056 so 0.000501 / 0.00056 ≈ 0.895 (above 0.85 threshold, below 1.0).
    await preflightCostCheck(baseReq, ctx, {
      budgetReader: budgetReader({ tenantId: 'tnt_1', monthlyBudgetUsd: 100, conversationBudgetUsd: 0.00056 }),
      ledger,
      onEvent: (e) => events.push(e),
    });
    expect(events.some((e) => e.type === 'cost-cap-warning')).toBe(true);
  });
});

describe('postflightCharge + ledger', () => {
  it('records charge and reflects in month-to-date', async () => {
    const ledger = new InMemorySpendLedger();
    const response: BrainLLMResponse = {
      id: 'm',
      model: 'anthropic/claude-haiku-4-5',
      provider: 'anthropic',
      content: [{ type: 'text', text: 'hi' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      latencyMs: 1,
    };
    const { chargedUsd } = await postflightCharge(response, { tenantId: 'tnt_1', conversationId: 'conv_a' }, ledger);
    expect(chargedUsd).toBeCloseTo(6, 4); // $1 + $5
    expect(await ledger.monthToDateSpend('tnt_1')).toBeCloseTo(6, 4);
    expect(await ledger.conversationSpend('tnt_1', 'conv_a')).toBeCloseTo(6, 4);
  });

  it('accumulates across multiple charges', async () => {
    const ledger = new InMemorySpendLedger();
    const response: BrainLLMResponse = {
      id: 'm',
      model: 'anthropic/claude-haiku-4-5',
      provider: 'anthropic',
      content: [],
      stopReason: 'end_turn',
      usage: { inputTokens: 500_000, outputTokens: 500_000 },
      latencyMs: 1,
    };
    await postflightCharge(response, { tenantId: 'tnt_1', conversationId: 'conv_a' }, ledger);
    await postflightCharge(response, { tenantId: 'tnt_1', conversationId: 'conv_a' }, ledger);
    expect(await ledger.monthToDateSpend('tnt_1')).toBeCloseTo(6, 4); // $0.5+$2.5 twice
    expect(ledger.count()).toBe(2);
  });
});
