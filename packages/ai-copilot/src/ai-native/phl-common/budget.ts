/**
 * Budget-guard helpers for PhL capabilities.
 *
 * Every capability MUST call `assertBudget(deps, context)` before any LLM
 * round-trip. On success the capability calls `recordAiUsage` to append
 * usage to the ledger. Both helpers are no-ops when no ledger is injected
 * (test mode).
 */

import type { CostLedger } from '../../cost-ledger.js';
import { AiBudgetExceededError } from '../../cost-ledger.js';
import type { BudgetContext } from './types.js';
import { logger } from '../../logger.js';

export interface BudgetGuardDeps {
  readonly ledger?: CostLedger;
}

export async function assertBudget(
  deps: BudgetGuardDeps,
  context: BudgetContext,
): Promise<void> {
  if (!deps.ledger) return;
  await deps.ledger.assertWithinBudget(context.tenantId);
}

export async function recordAiUsage(
  deps: BudgetGuardDeps,
  context: BudgetContext,
  call: {
    readonly provider: string;
    readonly model: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costUsdMicro: number;
  },
): Promise<void> {
  if (!deps.ledger) return;
  try {
    await deps.ledger.recordUsage({
      tenantId: context.tenantId,
      provider: call.provider,
      model: call.model,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      costUsdMicro: call.costUsdMicro,
      operation: context.operation,
      correlationId: context.correlationId,
    });
  } catch (err) {
     
    logger.error('[ai-native/phl] failed to record usage', { error: err instanceof Error ? err.message : err });
  }
}

export { AiBudgetExceededError };
