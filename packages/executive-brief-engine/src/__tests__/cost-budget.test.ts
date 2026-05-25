import { describe, expect, it } from 'vitest';
import { createInMemoryCostBudget } from '../cost-budget.js';

describe('createInMemoryCostBudget', () => {
  it('returns false for non-flagged tenants', async () => {
    const port = createInMemoryCostBudget();
    expect(await port.isOverBudget('ten_a')).toBe(false);
  });

  it('returns true when tenant is flagged', async () => {
    const port = createInMemoryCostBudget({ overBudgetTenants: ['ten_a'] });
    expect(await port.isOverBudget('ten_a')).toBe(true);
    expect(await port.isOverBudget('ten_b')).toBe(false);
  });

  it('toggles via setOverBudget', async () => {
    const port = createInMemoryCostBudget();
    port.setOverBudget('ten_a', true);
    expect(await port.isOverBudget('ten_a')).toBe(true);
    port.setOverBudget('ten_a', false);
    expect(await port.isOverBudget('ten_a')).toBe(false);
  });

  it('records costs', async () => {
    const port = createInMemoryCostBudget();
    await port.recordCost({
      tenantId: 'ten_a',
      costMicros: 1234,
      model: 'haiku',
      correlationId: 'c_1',
    });
    expect(port.recordedCosts()).toHaveLength(1);
    expect(port.recordedCosts()[0]!.costMicros).toBe(1234);
  });
});
