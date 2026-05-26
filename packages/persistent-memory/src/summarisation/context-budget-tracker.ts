/**
 * Context-budget tracker (Wave 18GG).
 *
 * Decides whether the working-memory token count exceeds the
 * summarisation threshold. Pure decider — no I/O.
 */

import {
  SUMMARISE_BLOCK_TOKENS,
  SUMMARISE_BUDGET_TOKENS,
} from '../types.js';

export interface BudgetDecision {
  readonly should_summarise: boolean;
  readonly headroom_tokens: number;
  readonly recommended_block_tokens: number;
}

export interface BudgetInput {
  readonly current_tokens: number;
  readonly budget_tokens?: number;
  readonly block_tokens?: number;
}

export function evaluateBudget(input: BudgetInput): BudgetDecision {
  const budget = input.budget_tokens ?? SUMMARISE_BUDGET_TOKENS;
  const block = input.block_tokens ?? SUMMARISE_BLOCK_TOKENS;
  if (budget <= 0) {
    throw new Error('budget_tokens must be positive');
  }
  if (block <= 0) {
    throw new Error('block_tokens must be positive');
  }

  const headroom = budget - input.current_tokens;
  return {
    should_summarise: input.current_tokens >= budget,
    headroom_tokens: Math.max(headroom, 0),
    recommended_block_tokens: block,
  };
}
