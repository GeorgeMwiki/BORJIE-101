import { describe, it, expect } from 'vitest';
import { evaluateBudget } from '../summarisation/context-budget-tracker.js';

describe('context-budget-tracker', () => {
  it('does not trigger summarisation below the budget', () => {
    const d = evaluateBudget({
      current_tokens: 500_000,
      budget_tokens: 700_000,
      block_tokens: 200_000,
    });
    expect(d.should_summarise).toBe(false);
    expect(d.headroom_tokens).toBe(200_000);
    expect(d.recommended_block_tokens).toBe(200_000);
  });

  it('triggers summarisation at the budget threshold', () => {
    const d = evaluateBudget({
      current_tokens: 700_000,
      budget_tokens: 700_000,
      block_tokens: 200_000,
    });
    expect(d.should_summarise).toBe(true);
    expect(d.headroom_tokens).toBe(0);
  });

  it('triggers summarisation above the budget', () => {
    const d = evaluateBudget({
      current_tokens: 900_000,
      budget_tokens: 700_000,
      block_tokens: 200_000,
    });
    expect(d.should_summarise).toBe(true);
    expect(d.headroom_tokens).toBe(0);
  });

  it('uses defaults when not specified', () => {
    const d = evaluateBudget({ current_tokens: 0 });
    expect(d.should_summarise).toBe(false);
    expect(d.recommended_block_tokens).toBeGreaterThan(0);
  });

  it('rejects non-positive budget', () => {
    expect(() =>
      evaluateBudget({ current_tokens: 0, budget_tokens: 0 }),
    ).toThrow();
  });

  it('rejects non-positive block', () => {
    expect(() =>
      evaluateBudget({ current_tokens: 0, block_tokens: 0 }),
    ).toThrow();
  });
});
